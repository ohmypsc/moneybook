import { apiRequest } from "./client";
import type { BootstrapResponse } from "../types/bootstrap";

/**
 * Bootstrap is cached transparently by bootstrapCache.ts.
 * Keep the endpoint itself behind one API helper so pages do not hard-code it.
 */
export function getBootstrap<TResponse = BootstrapResponse>() {
  return apiRequest<TResponse>("/api/bootstrap");
}
