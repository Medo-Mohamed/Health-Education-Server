import { app } from "../server";
import mongoose from "mongoose";
import dbConnect from "./dbConnect";
import env from "dotenv";
env.config();
const PORT = process.env.PORT || 3000;
dbConnect();
mongoose.connection.once("open", () => {
  console.log("Connected to Data Base MongoDB");
  app.listen(PORT, () => console.log("Server now listen on Port : " + PORT));
});
mongoose.connection.on("error", (e) => console.log("Error : ", e));
