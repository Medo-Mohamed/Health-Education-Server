import nodemailer from "nodemailer";
import env from "dotenv";

if (process.env.NODE_ENV !== "production") {
  env.config();
}

// 1. إنشاء الـ Transporter باستخدام متغيرات البيئة
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: 587,
  secure: process.env.SMTP_PORT === "465", // true للـ Port 465 و false للـ Ports الأخرى مثل 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 2. دالة التحقق من صحة الاتصال بخادم الـ SMTP عند بدء التشغيل
export const verifyEmailServer = async (): Promise<boolean> => {
  try {
    await transporter.verify();
    console.log("Email Server (SMTP) is ready to send messages!");
    return true;
  } catch (err) {
    console.error("Email Server Verification Failed:", err);
    return false;
  }
};
verifyEmailServer();
// 3. الواجهة (Interface) المحددة لبيانات الرسالة
export interface SendEmailOptions {
  to: string; // البريد الإلكتروني للمستلم
  subject: string; // عنوان الرسالة
  text?: string; // النص العادي للرسالة
  html?: string; // كود HTML للرسالة (تصميم الجداول والروابط)
  OTP: string;
}
const emailTemplate = (resetCode: string) => `
  <div style="font-family: Arial, sans-serif; text-align: right; direction: rtl; border: 1px solid #e0e0e0; padding: 20px; border-radius: 10px;">
    <h2 style="color: #2c3e50;">إعادة تعيين كلمة المرور</h2>
    <p>لقد طلبت إعادة تعيين كلمة المرور لمنصة <strong>Health Education Platform</strong>.</p>
    <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #3498db; border-radius: 5px;">
      ${resetCode}
    </div>
    <p style="margin-top: 20px;">هذا الكود صالح لمدة 10 دقائق فقط. إذا لم تطلب هذا الكود، يرجى تجاهل هذا الإيميل.</p>
    <hr style="border: 0; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #7f8c8d;">جميع الحقوق محفوظة © منصة التثقيف الصحي 2026</p>
  </div>
`;
// 4. الدالة الرئيسية لإرسال الرسائل
export const sendEmail = async (options: SendEmailOptions) => {
  try {
    const mailOptions = {
      from: `"${process.env.APP_NAME || "Health Education"}" <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: emailTemplate(options.OTP),
    };

    const info = await transporter.sendMail(mailOptions);
    // console.log("Email sent successfully: %s", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Error sending email:", error);
    throw new Error(`Email sending failed: ${error.message}`);
  }
};

export default sendEmail;
