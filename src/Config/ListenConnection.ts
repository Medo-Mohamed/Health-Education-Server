import { app } from "../server";
import mongoose from "mongoose";
import dbConnect from "./dbConnect";
import env from "dotenv";
env.config();
const PORT = process.env.PORT || 3000;
dbConnect();
mongoose.connection.once("open", () => {
  console.log("Connected to Data Base MongoDB");
  if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }
  // app.listen(PORT, () => console.log("Server now listen on Port : " + PORT));
});
mongoose.connection.on("error", (e) => console.log("Error : ", e));
