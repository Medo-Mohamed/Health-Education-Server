import { CorsOptions } from "cors";
import { allowedOrigins } from "./allowedOrigins";

type CorsCallback = (err: Error | null, allow?: boolean) => void;

export const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callBack: CorsCallback) => {
    // السماح بالطلبات إذا كانت بدون origin (مثل طلبات Server-to-Server أو Postman)
    // أو إذا كان الـ origin موجواداً داخل قائمة العناوين المسموح بها
    console.log(origin)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callBack(null, true);
    } else {
      callBack(new Error("Not Allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200, // 👈 تم تصحيح اسم الخاصية (optionsSuccessStatus)
};

export default corsOptions;
