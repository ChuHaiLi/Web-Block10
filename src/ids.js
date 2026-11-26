const { randomBytes } = require('node:crypto');

function newPhotoId()
{
    return randomBytes(9).toString('base64url');
}

module.exports = { newPhotoId };
