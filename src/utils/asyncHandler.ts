import type { Response, Request, NextFunction } from "express";

const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
) => {
  return function (req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn).catch((err) => {
      if (process.env.status === "devolop")
        console.log({ message: err.message, err });
      res.status(500).json({ message: err.message || "حدث خطأ في السرفر" });
    });
  };
};

export default asyncHandler;
