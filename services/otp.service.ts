const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: false,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
    },
});

const sendOtpEmail = async (email : string , otp : string) => {
    await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: "Your Collaborate X verification code",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
                <h2>Verify your email</h2>

                <p>
                    Use the following code to verify your Collaborate X account:
                </p>

                <div style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 10px;
                    margin: 25px 0;
                ">
                    ${otp}
                </div>

                <p>
                    This code will expire in 10 minutes.
                </p>

                <p>
                    If you didn't create an account, you can ignore this email.
                </p>
            </div>
        `,
    });
};

module.exports = {
    sendOtpEmail,
};