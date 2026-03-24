import mongoose from "mongoose";

export default async function () {
  try {
    // console.log(process.env.DATABASE_URL);
    await mongoose.connect(process.env.DATABASE_URL!);
  } catch (error) {
    console.log(error);
  }
}
