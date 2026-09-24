import mongoose from "mongoose";

export default async function () {
  try {
    // console.log(process.env.DATABASE_URL);
    const databaseUrl =
      process.env.STATE === "devolop"
        ? process.env.LOCAL_DATABASE_URL
        : process.env.ONLINE_DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("Database URL is not configured");
    }

    await mongoose.connect(databaseUrl);
  } catch (error) {
    console.log(error);
  }
}
