import experss from "express";
export const app = experss();
import env from "dotenv";
env.config();
import "./Config/Listen&Connection.ts";
import cookie from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import RootRouter from "./routes/Root.ts";

app.use(experss.json());
app.use(cookie());
app.use(
  session({
    secret: process.env.SECRET_SESSION_KEY || "", // will come from .env
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: 1000 * 60 * 60,
    },
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
    }),
  }),
);

app.use(RootRouter);
