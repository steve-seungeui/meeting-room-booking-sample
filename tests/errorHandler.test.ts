import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { errorHandler } from "../src/http/errorHandler.js";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../src/shared/errors.js";

function appThrowing(error: unknown) {
  const app = express();
  app.use(express.json());
  app.post("/echo", (req, res) => {
    res.json(req.body);
  });
  app.get("/throw", () => {
    throw error;
  });
  app.get("/async-throw", async () => {
    throw error;
  });
  app.get("/stored", (_req, res) => {
    res.json(JSON.parse("{깨진 저장값"));
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const domainCases = [
    { error: new ValidationError("제목이 비어 있습니다"), status: 400, code: "VALIDATION_FAILED" },
    { error: new NotFoundError("room-999 회의실이 없습니다"), status: 404, code: "NOT_FOUND" },
    { error: new ConflictError("이미 예약된 시간입니다"), status: 409, code: "CONFLICT" },
    { error: new DomainError("직접 만든 오류", "CUSTOM", 422), status: 422, code: "CUSTOM" },
  ];

  for (const { error, status, code } of domainCases) {
    it(`${error.name}를 던지면 ${status}와 { code, message }를 돌려준다`, async () => {
      const response = await request(appThrowing(error)).get("/throw");

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ code, message: error.message });
      expect(consoleError).not.toHaveBeenCalled();
    });
  }

  it("async 라우트에서 던진 DomainError도 같은 방식으로 처리한다", async () => {
    const response = await request(appThrowing(new ConflictError("이미 예약된 시간입니다"))).get("/async-throw");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "CONFLICT", message: "이미 예약된 시간입니다" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("잘못된 JSON 본문이면 400 INVALID_JSON을 돌려준다", async () => {
    const response = await request(appThrowing(new Error("unused")))
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('{"title": ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: "INVALID_JSON", message: "요청 본문이 올바른 JSON이 아닙니다." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("올바른 JSON 본문은 오류 없이 라우트에 전달된다", async () => {
    const response = await request(appThrowing(new Error("unused"))).post("/echo").send({ title: "회의" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ title: "회의" });
  });

  // 확인 필요: express.json()이 상태 코드를 붙여 넘기는 다른 오류(본문 크기 초과 413 등)도 현재는 500으로 바뀐다.
  it("JSON 파서의 본문 크기 초과 오류는 현재 500 INTERNAL_ERROR로 응답한다", async () => {
    const response = await request(appThrowing(new Error("unused")))
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ title: "가".repeat(200_000) }));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." });
  });

  it("그 밖의 에러는 500 INTERNAL_ERROR를 돌려주고 내부 메시지를 노출하지 않는다", async () => {
    const response = await request(appThrowing(new Error("db password=secret 연결 실패"))).get("/throw");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." });
    expect(response.text).not.toContain("secret");
  });

  it("500 경로에서는 원래 에러를 console.error로 기록한다", async () => {
    const error = new TypeError("undefined의 속성을 읽을 수 없음");

    await request(appThrowing(error)).get("/async-throw");

    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it("Error가 아닌 값을 던져도 500 INTERNAL_ERROR를 돌려준다", async () => {
    const response = await request(appThrowing("문자열 오류")).get("/throw");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." });
  });

  // 기대: 요청 본문이 아닌 서버 내부 코드(예: DB에 저장된 값의 JSON.parse)에서 난 SyntaxError는
  //       클라이언트 잘못이 아니므로 500 INTERNAL_ERROR로 응답하고 console.error로 기록해야 한다.
  // 실제: errorHandler가 SyntaxError 전부를 400 INVALID_JSON("요청 본문이 올바른 JSON이 아닙니다.")으로 바꾸고
  //       로그도 남기지 않는다.
  it.fails("라우트 코드 안의 JSON.parse 실패는 요청 본문 오류가 아니므로 500으로 처리한다", async () => {
    const response = await request(appThrowing(new Error("unused"))).get("/stored");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(consoleError).toHaveBeenCalled();
  });
});
