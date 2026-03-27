import { allowedOririns } from "./allowedOrigins.ts";
type NewType = (err: Error | null, allow?: boolean) => void;

export default {
  origin: (origin: string | undefined, callBack: NewType) => {
    if (!origin || allowedOririns.indexOf(origin) !== -1) {
      callBack(null, true);
    } else callBack(new Error("Not Allowed by Cors"));
  },
  credentials: true,
  optionSuccessStatus: 200,
};
