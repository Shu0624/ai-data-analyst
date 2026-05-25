from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserProfile, Dataset, ChatSession, AIQuery
from routers.auth import get_current_user
from schemas.users import (
    UpdateUserRequest,
    UpdateProfileRequest,
    FullUserResponse,
    DashboardSummaryResponse,
    MessageResponse,
)

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# GET /users/me  — full profile including user_profiles table
# ════════════════════════════════════════════════════════════════
@router.get(
    "/me",
    response_model=FullUserResponse,
    summary="Get full profile of logged-in user",
)
def get_me(
    current_user: User = Depends(get_current_user),
):
    """
    Returns the full user object including profile info
    (company, industry, experience level).
    If no profile exists yet, profile will be null.
    """
    return current_user


# ════════════════════════════════════════════════════════════════
# PUT /users/update  — update name or email
# ════════════════════════════════════════════════════════════════
@router.put(
    "/update",
    response_model=FullUserResponse,
    summary="Update user name or email",
)
def update_user(
    body: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update the authenticated user's name and/or email.
    - Rejects if new email is already taken by another account
    - Only updates fields that are provided
    """
    # Nothing to update
    if body.name is None and body.email is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one field to update (name or email)",
        )

    # Check if new email is already taken by a DIFFERENT user
    if body.email:
        existing = db.query(User).filter(
            User.email == body.email.lower().strip(),
            User.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already used by another account",
            )
        current_user.email = body.email.lower().strip()

    if body.name:
        current_user.name = body.name.strip()

    current_user.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(current_user)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user. Please try again.",
        )

    return current_user


# ════════════════════════════════════════════════════════════════
# PUT /users/profile  — create or update user_profiles table
# ════════════════════════════════════════════════════════════════
@router.put(
    "/profile",
    response_model=FullUserResponse,
    summary="Create or update company/industry/experience profile",
)
def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Creates a user profile if one doesn't exist yet.
    Updates it if it already exists.
    Fields not provided will remain unchanged.
    """
    # Nothing to update
    if all(v is None for v in [body.company_name, body.industry, body.experience_level]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one field to update",
        )

    profile = current_user.profile

    # Create profile if it doesn't exist yet
    if not profile:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    # Update only provided fields
    if body.company_name     is not None:
        profile.company_name     = body.company_name.strip()
    if body.industry          is not None:
        profile.industry          = body.industry.strip()
    if body.experience_level  is not None:
        profile.experience_level  = body.experience_level

    try:
        db.commit()
        db.refresh(current_user)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile. Please try again.",
        )

    return current_user


# ════════════════════════════════════════════════════════════════
# GET /users/dashboard-summary  — stats for the dashboard page
# ════════════════════════════════════════════════════════════════
@router.get(
    "/dashboard-summary",
    response_model=DashboardSummaryResponse,
    summary="Get dashboard statistics for the logged-in user",
)
def dashboard_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns counts used on the main dashboard:
    - Total datasets uploaded
    - Total chat sessions started
    - Total AI queries made
    - Most recent session name and date
    """
    total_datasets = db.query(Dataset).filter(
        Dataset.user_id == current_user.id
    ).count()

    total_sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).count()

    # Count all queries made by this user across all sessions
    total_queries = (
        db.query(AIQuery)
        .join(ChatSession, AIQuery.session_id == ChatSession.id)
        .filter(ChatSession.user_id == current_user.id)
        .count()
    )

    # Get most recent session
    recent_session = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.last_activity.desc())
        .first()
    )

    return {
        "total_datasets":      total_datasets,
        "total_sessions":      total_sessions,
        "total_queries":       total_queries,
        "recent_session_name": recent_session.session_name if recent_session else None,
        "recent_session_date": recent_session.last_activity if recent_session else None,
    }