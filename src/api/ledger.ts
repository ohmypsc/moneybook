import {
  apiRequest
} from "./client";

import type {
  BootstrapResponse
} from "../types/api";


export function getBootstrap() {

  return apiRequest<
    BootstrapResponse
  >(
    "/api/bootstrap"
  );
}
