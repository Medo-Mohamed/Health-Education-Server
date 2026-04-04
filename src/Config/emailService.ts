import { BrevoClient } from "@getbrevo/brevo";

// 1. إنشاء العميل باستخدام الـ API Key
const client = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY as string,
});

export const sendBrevoEmail = async (
  toEmail: string,
  subject: string,
  htmlContent: string,
) => {
  try {
    // 2. إرسال الإيميل باستخدام الطريقة الجديدة
    const response = await client.transactionalEmails.sendTransacEmail({
      subject: subject,
      htmlContent: htmlContent,
      sender: {
        name: "منصة التثقيف الصحي",
        email: process.env.BREVO_EMAIL, // يجب أن يكون موثقاً في Brevo
      },
      to: [{ email: toEmail }],
    });

    // console.log("تم الإرسال بنجاح:", response);
    return true;
  } catch (error) {
    // console.error("خطأ في إرسال البريد عبر BrevoClient:", error);
    return false;
  }
};
