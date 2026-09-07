import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const parseBody = <T>(schema: ZodType<T>, request: FastifyRequest): T => {
  try {
    return schema.parse(request.body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数不正确。", error.issues);
    }
    throw error;
  }
};

export const parseQuery = <T>(schema: ZodType<T>, request: FastifyRequest): T => {
  try {
    return schema.parse(request.query);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "查询参数不正确。", error.issues);
    }
    throw error;
  }
};

export const parseParams = <T>(schema: ZodType<T>, request: FastifyRequest): T => {
  try {
    return schema.parse(request.params);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "路径参数不正确。", error.issues);
    }
    throw error;
  }
};

export const errorHandler = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, details: error.details },
      requestId: request.id,
    });
  }
  const candidate = error as { code?: string; message?: string; statusCode?: number };
  if (candidate.code === "23505") {
    return reply.status(409).send({
      error: { code: "CONFLICT", message: "资源已经存在。" },
      requestId: request.id,
    });
  }
  request.log.error(error);
  return reply
    .status(candidate.statusCode && candidate.statusCode < 500 ? candidate.statusCode : 500)
    .send({
      error: {
        code: candidate.statusCode === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
        message:
          candidate.statusCode && candidate.statusCode < 500
            ? candidate.message
            : "服务暂时不可用。",
      },
      requestId: request.id,
    });
};

export const requireRevision = (request: FastifyRequest) => {
  const value = request.headers["if-match"];
  const revision = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ApiError(428, "REVISION_REQUIRED", "更新操作需要有效的 If-Match 版本号。");
  }
  return revision;
};
