const jwt = require('jsonwebtoken');
require('dotenv').config();

const secret = '7111fd7224964bbd0c0456eb728a5154f9b279298c98dec55f9071970a17f6d3'; // process.env.JWT_SECRET;

function generateToken(username, role) {
    return jwt.sign({ username, role }, secret);
}

function verifyToken(token) {
    try {
        jwt.verify(token, secret);
        return true;
    } catch (err) {
        return false;
    }
}

module.exports = { generateToken, verifyToken };