const dotenv = require('dotenv');

dotenv.config();

const env = {
    port: process.env.PORT,
    mongo_url: process.env.MONGO_URI
}

module.exports = env;