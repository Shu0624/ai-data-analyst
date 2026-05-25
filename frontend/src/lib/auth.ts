import { api } from "./api"
import { useAuthStore } from "./store"

// ── Types ────────────────────────────────────────────────────

interface LoginPayload {
  email: string
  password: string
}

interface SignupPayload {
  name: string
  email: string
  password: string
}

interface VerifyEmailPayload {
  email: string
  otp: string
}

interface ResendOTPPayload {
  email: string
  purpose: "verify_email" | "reset_password"
}

interface ForgotPasswordPayload {
  email: string
}

interface ResetPasswordPayload {
  email: string
  otp: string
  new_password: string
}

interface ChangePasswordPayload {
  current_password: string
  new_password: string
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

interface UserResponse {
  id: string
  name: string
  email: string
  role: string
  is_verified: boolean
  created_at: string
}

interface MessageResponse {
  message: string
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract human-readable error message from Axios error responses.
 * FastAPI returns `{ detail: "..." }` on validation/HTTP errors.
 */
function extractError(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const resp = (err as { response?: { data?: { detail?: string | { msg: string }[] } } }).response
    const detail = resp?.data?.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map((d) => d.msg).join(". ")
  }
  if (err instanceof Error) return err.message
  return "Something went wrong. Please try again."
}

// ── Auth API Functions ───────────────────────────────────────

/** POST /auth/signup */
export async function signupUser(payload: SignupPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.post<MessageResponse>("/auth/signup", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/verify-email */
export async function verifyEmail(payload: VerifyEmailPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.post<MessageResponse>("/auth/verify-email", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/resend-otp */
export async function resendOTP(payload: ResendOTPPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.post<MessageResponse>("/auth/resend-otp", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/login — stores tokens + user in Zustand */
export async function loginUser(payload: LoginPayload): Promise<UserResponse> {
  try {
    // Step 1: get tokens
    const { data: tokens } = await api.post<TokenResponse>("/auth/login", payload)

    // Step 2: temporarily set token so the /auth/me call works
    useAuthStore.getState().login(
      { id: "", name: "", email: payload.email, role: "", is_verified: true, created_at: "" },
      tokens.access_token,
      tokens.refresh_token
    )

    // Step 3: fetch full user profile
    const { data: user } = await api.get<UserResponse>("/auth/me")

    // Step 4: store real user data
    useAuthStore.getState().login(user, tokens.access_token, tokens.refresh_token)

    return user
  } catch (err) {
    // If login failed, make sure store is clean
    useAuthStore.getState().logout()
    throw new Error(extractError(err))
  }
}

/** GET /auth/me — fetch current user (requires valid token) */
export async function fetchCurrentUser(): Promise<UserResponse> {
  try {
    const { data } = await api.get<UserResponse>("/auth/me")
    useAuthStore.getState().setUser(data)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/logout — revokes refresh token */
export async function logoutUser(): Promise<void> {
  const refreshToken = useAuthStore.getState().refreshToken
  try {
    if (refreshToken) {
      await api.post("/auth/logout", { refresh_token: refreshToken })
    }
  } catch {
    // Logout should always succeed client-side even if API call fails
  } finally {
    useAuthStore.getState().logout()
  }
}

/** POST /auth/forgot-password */
export async function forgotPassword(payload: ForgotPasswordPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.post<MessageResponse>("/auth/forgot-password", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/reset-password */
export async function resetPassword(payload: ResetPasswordPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.post<MessageResponse>("/auth/reset-password", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** PUT /auth/change-password */
export async function changePassword(payload: ChangePasswordPayload): Promise<MessageResponse> {
  try {
    const { data } = await api.put<MessageResponse>("/auth/change-password", payload)
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** DELETE /auth/delete-account */
export async function deleteAccount(): Promise<MessageResponse> {
  try {
    const { data } = await api.delete<MessageResponse>("/auth/delete-account")
    useAuthStore.getState().logout()
    return data
  } catch (err) {
    throw new Error(extractError(err))
  }
}

/** POST /auth/dev-login — [DEV ONLY] bypass credentials & OTP verification */
export async function devLoginUser(): Promise<UserResponse> {
  try {
    const { data: tokens } = await api.post<TokenResponse>("/auth/dev-login")
    useAuthStore.getState().login(
      { id: "", name: "", email: "dev@localhost.com", role: "", is_verified: true, created_at: "" },
      tokens.access_token,
      tokens.refresh_token
    )
    const { data: user } = await api.get<UserResponse>("/auth/me")
    useAuthStore.getState().login(user, tokens.access_token, tokens.refresh_token)
    return user
  } catch (err) {
    useAuthStore.getState().logout()
    throw new Error(extractError(err))
  }
}
