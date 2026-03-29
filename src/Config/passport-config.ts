import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import User, { type IUser } from "../Models/User.ts";

passport.use(
  new LocalStrategy(
    { usernameField: "username" }, // أو 'username' حسب التصميم الخاص بك
    async (username, password, done) => {
      try {
        // console.log("Attempting to login with username:", username);
        // 1. البحث عن المستخدم وجلب الباسورد (لأننا وضعنا select: false في الـ Schema)
        const user = await User.findOne({ username }).select("+password");

        if (!user) {
          return done({ message: "البريد الإلكتروني غير مسجل" }, false);
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
          return done({ message: "كلمة المرور غير صحيحة" }, false);
        }

        return done(null, user);
      } catch (err) {
        console.error("Error during authentication:", err);
        return done(err);
      }
    },
  ),
);

// 3. تحديد ما يتم تخزينه في الـ Session (الـ ID فقط لتوفير المساحة)
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// 4. استعادة بيانات المستخدم من الـ ID عند كل طلب
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
