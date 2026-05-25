import os
import secrets
import hashlib
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from dotenv import load_dotenv

from database import get_db
from models import User, RefreshToken
from services.email import send_otp_email
from schemas.auth import (
    SignupRequest,
    LoginRequest,
    VerifyOTPRequest,
    ResendOTPRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ChangePasswordRequest,
    TokenResponse,
    AccessTokenResponse,
    RefreshTokenRequest,
    LogoutRequest,
    UserResponse,
    MessageResponse,
)

load_dotenv()

# ── Config ────────────────────────────────────────────────────
SECRET_KEY                  = os.getenv("SECRET_KEY")
ALGORITHM                   = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))
REFRESH_TOKEN_EXPIRE_DAYS   = 7
OTP_EXPIRE_MINUTES          = 10
OTP_RATE_LIMIT_SECONDS      = 60
MAX_OTP_ATTEMPTS            = 5

# Fix #2: Validate SECRET_KEY on startup
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set in .env")

# Fix #3: Generate valid dummy hash once at startup
DUMMY_HASH = bcrypt.hashpw(b"dummy_password_placeholder", bcrypt.gensalt()).decode()

bearer_scheme = HTTPBearer()
router        = APIRouter()


# ════════════════════════════════════════════════════════════════
# PASSWORD UTILITIES
# ════════════════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ════════════════════════════════════════════════════════════════
# OTP UTILITIES
# ════════════════════════════════════════════════════════════════

def generate_otp() -> str:
    """
    Generate a cryptographically secure random 6-digit OTP.
    BUG FIX: was using random.randint() which is NOT cryptographically
    secure — OTPs could be predicted by an attacker with enough samples.
    secrets module uses OS-level CSPRNG (urandom).
    """
    return str(secrets.randbelow(900000) + 100000)


def hash_otp(otp: str) -> str:
    """Fix #10: Store OTP as bcrypt hash — never plaintext."""
    return bcrypt.hashpw(otp.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_otp_hash(plain_otp: str, hashed_otp: str) -> bool:
    """Verify OTP against its bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_otp.encode("utf-8"), hashed_otp.encode("utf-8"))
    except Exception:
        return False


def save_otp(
    db:      Session,
    user:    User,
    otp:     str,
    purpose: str,
) -> None:
    """
    Save hashed OTP to user record.
    Fix #14: also updates updated_at.
    Fix #10: stores hash not plaintext.
    """
    now                = datetime.utcnow()
    user.otp_hash      = hash_otp(otp)
    user.otp_expires_at = now + timedelta(minutes=OTP_EXPIRE_MINUTES)
    user.otp_created_at = now
    user.otp_purpose   = purpose
    user.otp_attempts  = 0
    user.updated_at    = now
    # No commit here — caller commits


def clear_otp(db: Session, user: User) -> None:
    """Clear OTP fields after successful verification."""
    user.otp_hash       = None
    user.otp_expires_at = None
    user.otp_created_at = None
    user.otp_purpose    = None
    user.otp_attempts   = 0
    user.updated_at     = datetime.utcnow()
    # No commit here — caller commits


def check_otp_rate_limit(user: User) -> None:
    """
    Fix #4: Rate limit using otp_created_at — not expiry math.
    Raises 429 if user requests OTP within 60 seconds.
    """
    if user.otp_created_at:
        diff = datetime.utcnow() - user.otp_created_at
        if diff.total_seconds() < OTP_RATE_LIMIT_SECONDS:
            wait = int(OTP_RATE_LIMIT_SECONDS - diff.total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait} seconds before requesting a new OTP",
            )


def validate_otp(
    db:      Session,
    user:    User,
    otp:     str,
    purpose: str,
) -> None:
    """
    Validates OTP — raises HTTPException on any failure.
    Fix #15: tracks attempts, blocks after MAX_OTP_ATTEMPTS.
    """
    # Check purpose matches
    if user.otp_purpose != purpose:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No pending {purpose.replace('_', ' ')} OTP found",
        )

    # Check OTP exists
    if not user.otp_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP found. Please request a new one",
        )

    # Fix #15: Check attempt limit
    if user.otp_attempts >= MAX_OTP_ATTEMPTS:
        clear_otp(db, user)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect OTP attempts. Please request a new OTP",
        )

    # Check expiry
    if datetime.utcnow() > user.otp_expires_at:
        clear_otp(db, user)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please request a new one",
        )

    # Verify OTP hash
    if not verify_otp_hash(otp, user.otp_hash):
        user.otp_attempts += 1
        remaining = MAX_OTP_ATTEMPTS - user.otp_attempts
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incorrect OTP. {remaining} attempt(s) remaining",
        )


# ════════════════════════════════════════════════════════════════
# JWT UTILITIES
# ════════════════════════════════════════════════════════════════

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire    = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token_str(data: dict) -> str:
    to_encode = data.copy()
    expire    = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def hash_token(token: str) -> str:
    """Hash a token string for DB storage using SHA-256."""
    return hashlib.sha256(token.encode()).hexdigest()


def store_refresh_token(db: Session, user_id: UUID, token: str) -> None:
    """Fix #7: Store refresh token hash in DB for revocation support."""
    db.add(RefreshToken(
        user_id    = user_id,
        token_hash = hash_token(token),
        expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        revoked    = False,
    ))


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(
        User.email == email.lower().strip()
    ).first()


def get_user_by_id(db: Session, user_id) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


# ════════════════════════════════════════════════════════════════
# DEPENDENCY — get current logged-in user
# ════════════════════════════════════════════════════════════════

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db:          Session                       = Depends(get_db),
) -> User:
    token   = credentials.credentials
    payload = decode_token(token)

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type — use your access token",
        )

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing user ID",
        )

    # Fix #6: Convert string to UUID before DB query
    try:
        user_id = UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User belonging to this token no longer exists",
        )

    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


# ════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════

# ── POST /auth/signup ─────────────────────────────────────────
@router.post(
    "/signup",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    """
    Creates account and sends OTP to email for verification.
    Fix #9: role is always hardcoded to 'user' — no escalation possible.
    """
    if get_user_by_email(db, body.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    otp      = generate_otp()
    new_user = User(
        name          = body.name.strip(),
        email         = body.email.lower().strip(),
        password_hash = hash_password(body.password),
        role          = "user",   # Fix #9: always user, ignore any input
        is_verified   = False,
    )
    save_otp(db, new_user, otp, "verify_email")

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account. Please try again.",
        )

    # Fix #8: email errors never crash the API
    email_sent = send_otp_email(
        to_email=new_user.email,
        otp_code=otp,
        purpose="verify_email",
        user_name=new_user.name,
    )

    if not email_sent:
        return {"message": "Account created but email delivery failed. Use resend-otp to get your OTP."}

    return {"message": "Account created. Check your email for the 6-digit OTP to verify your account."}


# ── POST /auth/verify-email ───────────────────────────────────
@router.post(
    "/verify-email",
    response_model=MessageResponse,
    summary="Verify email using OTP sent after signup",
)
def verify_email(body: VerifyOTPRequest, db: Session = Depends(get_db)):
    """Verifies email OTP — activates the account."""
    user = get_user_by_email(db, body.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email",
        )

    if user.is_verified:
        return {"message": "Email already verified. You can log in."}

    validate_otp(db, user, body.otp, "verify_email")

    user.is_verified = True
    clear_otp(db, user)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify email. Please try again.",
        )

    return {"message": "Email verified successfully. You can now log in."}


# ── POST /auth/resend-otp ─────────────────────────────────────
@router.post(
    "/resend-otp",
    response_model=MessageResponse,
    summary="Resend OTP — for verify_email or reset_password",
)
def resend_otp(body: ResendOTPRequest, db: Session = Depends(get_db)):
    """
    Resend OTP for email verification or password reset.
    Fix #4: rate limited to once per 60 seconds.
    """
    user = get_user_by_email(db, body.email)
    if not user:
        # Don't reveal if email exists
        return {"message": "If an account exists, an OTP has been sent."}

    if body.purpose == "verify_email" and user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already verified",
        )

    # Fix #4: Rate limit check
    check_otp_rate_limit(user)

    otp = generate_otp()
    save_otp(db, user, otp, body.purpose)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate OTP. Please try again.",
        )

    # Fix #8: email errors don't crash
    send_otp_email(
        to_email=user.email,
        otp_code=otp,
        purpose=body.purpose,
        user_name=user.name,
    )

    return {"message": "OTP sent. Check your email."}


# ── POST /auth/login ──────────────────────────────────────────
@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login and receive access + refresh tokens",
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """
    - Blocks unverified users from logging in
    - Timing-safe password check
    - Stores refresh token in DB for revocation support
    """
    user = get_user_by_email(db, body.email)

    # Fix #3: use proper DUMMY_HASH
    password_ok = verify_password(
        body.password,
        user.password_hash if user else DUMMY_HASH,
    )

    if not user or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in. Check your inbox for OTP.",
        )

    token_data    = {"sub": str(user.id), "email": user.email, "role": user.role}
    access_token  = create_access_token(token_data)
    refresh_token = create_refresh_token_str(token_data)

    # Fix #7: store refresh token hash in DB
    try:
        store_refresh_token(db, user.id, refresh_token)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed. Please try again.",
        )

    return {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
    }


# ── POST /auth/refresh ────────────────────────────────────────
@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange refresh token for new access + refresh tokens",
)
def refresh_token(body: RefreshTokenRequest, db: Session = Depends(get_db)):
    """
    Fix #7: Validates refresh token exists in DB and is not revoked.
    Rotates refresh token on every use (old one revoked, new one issued).
    """
    payload = decode_token(body.refresh_token)

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type — use your refresh token",
        )

    # Fix #7: Check token in DB
    token_hash = hash_token(body.refresh_token)
    stored     = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked    == False,
    ).first()

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid or has been revoked",
        )

    if datetime.utcnow() > stored.expires_at:
        stored.revoked = True
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired. Please log in again.",
        )

    # Fix #6: UUID conversion
    try:
        user_id = UUID(payload.get("sub"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
        )

    # Rotate: revoke old, issue new
    stored.revoked = True

    token_data    = {"sub": str(user.id), "email": user.email, "role": user.role}
    access_token  = create_access_token(token_data)
    new_refresh   = create_refresh_token_str(token_data)
    store_refresh_token(db, user.id, new_refresh)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Token refresh failed. Please log in again.",
        )

    return {
        "access_token":  access_token,
        "refresh_token": new_refresh,
        "token_type":    "bearer",
    }


# ── POST /auth/logout ─────────────────────────────────────────
@router.post(
    "/logout",
    response_model=MessageResponse,
    summary="Logout — revoke refresh token",
)
def logout(
    body:         LogoutRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Fix #7: Revokes the refresh token so it cannot be reused."""
    token_hash = hash_token(body.refresh_token)
    stored     = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.user_id    == current_user.id,
    ).first()

    if stored:
        stored.revoked = True
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {"message": "Logged out successfully"}


# ── GET /auth/me ──────────────────────────────────────────────
@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get the currently logged-in user's info",
)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ── POST /auth/forgot-password ────────────────────────────────
@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    summary="Request a password reset OTP",
)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Sends OTP to the email for password reset.
    Never reveals if the email exists (security best practice).
    """
    user = get_user_by_email(db, body.email)

    if not user:
        # Don't reveal if email exists — prevents user enumeration
        return {"message": "If an account exists with this email, an OTP has been sent."}

    # Fix #4: Rate limit
    check_otp_rate_limit(user)

    otp = generate_otp()
    save_otp(db, user, otp, "reset_password")

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate OTP. Please try again.",
        )

    # Fix #8: email errors don't crash
    send_otp_email(
        to_email=user.email,
        otp_code=otp,
        purpose="reset_password",
        user_name=user.name,
    )

    return {"message": "If an account exists with this email, an OTP has been sent."}


# ── POST /auth/reset-password ─────────────────────────────────
@router.post(
    "/reset-password",
    response_model=MessageResponse,
    summary="Reset password using OTP",
)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    Verifies OTP then resets password.
    Fix #5: explicit db.commit() after all changes.
    """
    user = get_user_by_email(db, body.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email",
        )

    validate_otp(db, user, body.otp, "reset_password")

    # Reject if same as current password
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password",
        )

    user.password_hash = hash_password(body.new_password)
    user.updated_at    = datetime.utcnow()
    clear_otp(db, user)

    # Fix #5: explicit commit — don't rely on clear_otp
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password. Please try again.",
        )

    return {"message": "Password reset successfully. You can now log in."}


# ── PUT /auth/change-password ─────────────────────────────────
@router.put(
    "/change-password",
    response_model=MessageResponse,
    summary="Change password for the logged-in user",
)
def change_password(
    body:         ChangePasswordRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Requires current password — cannot be used without being logged in.
    This is different from reset-password which uses OTP.
    """
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if verify_password(body.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password",
        )

    try:
        current_user.password_hash = hash_password(body.new_password)
        current_user.updated_at    = datetime.utcnow()
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update password. Please try again.",
        )

    return {"message": "Password changed successfully"}


# ── DELETE /auth/delete-account ───────────────────────────────
@router.delete(
    "/delete-account",
    response_model=MessageResponse,
    summary="Permanently delete the logged-in user's account",
)
def delete_account(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """All related data cascade-deleted by PostgreSQL."""
    try:
        db.delete(current_user)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete account. Please try again.",
        )

    return {"message": "Account permanently deleted"}


# ── POST /auth/dev-login (DEV ONLY) ──────────────────────────
@router.post(
    "/dev-login",
    response_model=TokenResponse,
    summary="[DEV ONLY] Auto-login without OTP — creates a dev user if needed",
)
def dev_login(db: Session = Depends(get_db)):
    """
    Creates a pre-verified dev user and returns tokens immediately.
    No password, no OTP, no email required. For local development only.
    """
    dev_email = "dev@localhost.com"
    dev_name  = "Dev User"
    dev_pass  = "devpassword123"

    user = get_user_by_email(db, dev_email)

    if not user:
        user = User(
            name          = dev_name,
            email         = dev_email,
            password_hash = hash_password(dev_pass),
            role          = "user",
            is_verified   = True,
        )
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create dev user",
            )

    token_data    = {"sub": str(user.id), "email": user.email, "role": user.role}
    access_token  = create_access_token(token_data)
    refresh_token = create_refresh_token_str(token_data)

    try:
        store_refresh_token(db, user.id, refresh_token)
        db.commit()
    except Exception:
        db.rollback()

    return {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
    }