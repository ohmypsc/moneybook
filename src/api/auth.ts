import {
  apiRequest
} from "./client";

import type {
  LoginResponse,
  LogoutResponse,
  SessionResponse
} from "../types/api";


export function getSession() {

  return apiRequest<
    SessionResponse
  >(
    "/api/auth/session"
  );
}


export function login(
  name: string,
  password: string
) {

  return apiRequest<
    LoginResponse
  >(
    "/api/auth/login",

    {
      method: "POST",

      body:
        JSON.stringify({
          name,
          password
        })
    }
  );
}


export function logout() {

  return apiRequest<
    LogoutResponse
  >(
    "/api/auth/logout",

    {
      method: "POST"
    }
  );
}
