import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import User, { type IUser } from "../Models/User.ts";

passport.use(
  new LocalStrategy(
    { usernameField: "username" }, // أو 'username' حسب التصميم الخاص بك
    async (username, password, done) => {
      try {
        // 1. البحث عن المستخدم وجلب الباسورد (لأننا وضعنا select: false في الـ Schema)
        const user = await User.findOne({ username }).select("+password");

        if (!user) {
          return done(null, false, { message: "البريد الإلكتروني غير مسجل" });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
          return done(null, false, { message: "كلمة المرور غير صحيحة" });
        }

        return done(null, user);
      } catch (err) {
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
