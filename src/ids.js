const { randomBytes } = require('node:crypto');

function newId()
{
    return randomBytes(9).toString('base64url');
}

module.exports = { newId };
