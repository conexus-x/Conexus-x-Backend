import crypto from "crypto";


export const generateApiKey = (): string => {

    const randomBytes = crypto.randomBytes(32).toString("hex");

    return `crm_${randomBytes}`;

};
