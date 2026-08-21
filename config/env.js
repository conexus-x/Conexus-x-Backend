const dotenv = require('dotenv');

dotenv.config();

const port = process.env.PORT || 4040;

const env = {
    port,
    mongo_url: process.env.MONGO_URI,
    jwt_secret: process.env.JWT_SECRET,
    client_url: process.env.CLIENT_URL || "http://localhost:3000",
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    google_redirect_uri:
        process.env.GOOGLE_REDIRECT_URI ||
        `http://localhost:${port}/api/auth/google/callback`,

    cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
    cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET,
    cloudinary_folder: process.env.CLOUDINARY_FOLDER || "crm",
}

module.exports = env;
