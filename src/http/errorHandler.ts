import type { ErrorRequestHandler } from "express";
import { DomainError } from "../shared/errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ code: "INVALID_JSON", message: "요청 본문이 올바른 JSON이 아닙니다." });
    return;
  }
  console.error(error);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." });
};
