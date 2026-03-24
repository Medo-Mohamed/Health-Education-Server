import { app } from "../server.ts";
import mongoose from "mongoose";
import dbConnect from "./dbConnect.ts";
import env from "dotenv";
env.config();
const Port = process.env.Port || 3000;
dbConnect();
mongoose.connection.once("open", () => {
  console.log("Connected to Data Base MongoDB");
  app.listen(Port, () => console.log("Server now listen on Port : " + Port));
});
