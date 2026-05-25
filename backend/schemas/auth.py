from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from uuid import UUID
from datetime import datetime


# ── Signup ────────────────────────────────────────────────────
class SignupRequest(BaseModel):
    name:     str
    email:    EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def name_valid(cls, v):
        if not v.strip():
            raise ValueError("Name cannot be empty")
        if len(v.strip()) < 2:
            raise ValueError("Name must be at least 2 characters")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


# ── Login ─────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


# ── OTP Verification ──────────────────────────────────────────
class VerifyOTPRequest(BaseModel):
    email:   EmailStr
    otp:     str

    @field_validator("otp")
    @classmethod
    def otp_format(cls, v):
        if not v.strip().isdigit() or len(v.strip()) != 6:
            raise ValueError("OTP must be a 6-digit number")
        return v.strip()


# ── Resend OTP ────────────────────────────────────────────────
class ResendOTPRequest(BaseModel):
    email:   EmailStr
    purpose: str

    @field_validator("purpose")
    @classmethod
    def purpose_valid(cls, v):
        if v not in ("verify_email", "reset_password"):
            raise ValueError("purpose must be 'verify_email' or 'reset_password'")
        return v


# ── Forgot Password ───────────────────────────────────────────
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


# ── Reset Password ────────────────────────────────────────────
class ResetPasswordRequest(BaseModel):
    email:        EmailStr
    otp:          str
    new_password: str

    @field_validator("otp")
    @classmethod
    def otp_format(cls, v):
        if not v.strip().isdigit() or len(v.strip()) != 6:
            raise ValueError("OTP must be a 6-digit number")
        return v.strip()

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


# ── Change Password ───────────────────────────────────────────
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


# ── Token Responses ───────────────────────────────────────────
class TokenResponse(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


# ── Logout ────────────────────────────────────────────────────
class LogoutRequest(BaseModel):
    refresh_token: str


# ── User Response ─────────────────────────────────────────────
class UserResponse(BaseModel):
    id:          UUID
    name:        str
    email:       str
    role:        str
    is_verified: bool
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Generic Message ───────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str