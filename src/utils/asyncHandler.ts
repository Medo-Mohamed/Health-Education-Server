import type { Response, Request, NextFunction, RequestHandler } from "express";

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any>;

const asyncHandler = (fn: AsyncController): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (process.env.status === "devolop")
        console.log({ message: err.message, err });
      res.status(500).json({ message: err.message || "حدث خطأ في السرفر" });
    });
  };
};

export default asyncHandler;
