import experss from "express";
export const app = experss();
import env from "dotenv";
env.config();
import "./Config/Listen&Connection.ts";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import RootRouter from "./routes/Root.ts";
import cors from "cors";
import corsOptions from "./Config/corsOptions.ts";
import UsersRouter from "./routes/User/Users.ts";
import passport from "passport";
import "./Config/passport-config.ts";

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(experss.json());
app.use(
  session({
    secret: process.env.SECRET_SESSION_KEY as string,
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: 1000 * 60 * 60,
      secure: false, // لأنك على http
      httpOnly: true,
      sameSite: "lax", // 👈 ضروري جداً للسماح بتداول الكوكي بين منفذ 5173 و 5000
    },
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
    }),
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", UsersRouter);

app.all("*any", (req, res) => {
  res.status(404).json({ message: "404 Resource not found" });
});
