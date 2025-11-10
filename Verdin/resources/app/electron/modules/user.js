const db = require('../model/db');
const bcrypt = require("bcrypt");
const util = require('util');
const { generateToken } = require('./auth');
const { addLog } = require('./logs');
// const { user } = require('node-onvif/lib/modules/http-auth');

let userSession = {};

const dbGet   = util.promisify(db.get.bind(db));
const dbRun   = util.promisify(db.run.bind(db));
const bcryptCompare = util.promisify(bcrypt.compare);
const bcryptHash    = util.promisify(bcrypt.hash);

async function addUser(data) {
	return new Promise((resolve) => {
		const { username, password, confirm_pass, user_level } = data;
		const saltRounds = 10;

		if (password !== confirm_pass || confirm_pass === "") {
			return resolve({ status: 'failed', message: 'Passwords do not match!' });
		}

		bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
			if (err) {
				console.error('Error hashing password:', err.message);
				return resolve({ status: 'failed', message: 'Error occured while creating user' });
			}

			const userLevel = user_level === "admin" ? "admin" : "user";
			const token = generateToken(username, userLevel);

			const query = 'INSERT INTO users (username, password, user_token, user_level) VALUES (?, ?, ?, ?)';
			const params = [username, hashedPassword, token, userLevel];

			db.run(query, params, function (err) {
				if (err) {
					console.error('Error creating user:', err.message);
					return resolve({ status: 'failed', message: 'Error occured while creating user' });
				}
				return resolve({ status: 'success', message: 'Successfully created new user' });
			});
		});
	});

};


const authenticateUser = async (username, password) => {
	return new Promise((resolve) => {
		const query = "SELECT * FROM users WHERE username = ?";
		db.get(query, [username], (err, user) => {
			if (err) {
				console.error("Error fetching user:", err.message);
				return resolve({ status: "error", message: "Error fetching user" });
			}

			if (!user) {
				return resolve({ status: "error", message: "Invalid user credentials" });
			}

			bcrypt.compare(password, user.password, (bcryptErr, result) => {
				if (bcryptErr) {
					console.error("Error comparing passwords:", bcryptErr.message);
					return resolve({ status: "error", message: "Error comparing passwords" });
				}

				if (result) {
					userSession = {
						user_id: user.user_id,
						username: user.username,
						user_token: user.user_token,
						user_level: user.user_level,
					};

					addLog('Logged-in', user.username + ' successfully logged in.');
					return resolve({ status: "login-success", data: userSession });
				} else {
					return resolve({ status: "error", message: "Invalid user credentials" });
				}
			});
		});
	});
};

async function getAllUsers() {
	try {
		const rows = await new Promise((resolve, reject) => {
			db.all('SELECT * FROM users', (err, rows) => {
				if (err) {
					return reject({ message: 'Error fetching users' });
				}
				resolve(rows);
			});
		});

		return rows;
	} catch (error) {
		throw error;
	}
}

async function updateUsername(newUsername, userId) {
  if (!newUsername) {
    return { status: 'failed', message: 'Please provide a username.' };
  }

  try {
    const existing = await dbGet(
      'SELECT user_id FROM users WHERE username = ?',
      newUsername
    );
    if (existing) {
      return {
        status: 'failed',
        message: `Username '${newUsername}' is already taken.`,
      };
    }

    await dbRun(
      'UPDATE users SET username = ? WHERE user_id = ?',
      newUsername,
      userId
    );

    addLog(
      'Account Update',
      `User ID ${userId} changed username to '${newUsername}'`
    );
    userSession.username = newUsername;

    return {
      status: 'success',
      message: `Your username has been updated to '${newUsername}'.`,
    };
  } catch (err) {
    console.error('Error in updateUsername:', err);
    return {
      status: 'error',
      message: 'An internal error occurred while updating your username.',
    };
  }
}

async function updatePassword(old_pass, new_pass, verify_pass, user_id) {
  if (!old_pass || !new_pass || !verify_pass) {
    return { status: 'failed', message: 'Please fill all required fields.' };
  }
  if (new_pass !== verify_pass) {
    return { status: 'failed', message: 'New passwords do not match.' };
  }

  try {
    const user = await dbGet('SELECT username, password FROM users WHERE user_id = ?', user_id);
    if (!user) {
      return { status: 'failed', message: 'Invalid user credentials.' };
    }

    const isMatch = await bcryptCompare(old_pass, user.password);
    if (!isMatch) {
      return { status: 'failed', message: 'Current password is incorrect.' };
    }

    const saltRounds = 10;
    const hashed = await bcryptHash(new_pass, saltRounds);
    await dbRun(
      'UPDATE users SET password = ? WHERE user_id = ?',
      hashed,
      user_id
    );

    addLog('Account Update', `Password has been updated for user: ${user.username}`);

    return { status: 'success', message: 'Your password has been updated successfully.' };
  } catch (err) {
    console.error('Error in updatePassword:', err);
    return { status: 'error', message: 'An internal error occurred.' + err };
  }
}

async function updateUser(userId, userData) {
  try {
    const { username, user_level } = userData;
    
    if (!username || username.trim() === '') {
      return { status: 'failed', message: 'Username is required' };
    }

    // Check if username already exists (excluding current user)
    const existing = await dbGet(
      'SELECT user_id FROM users WHERE username = ? AND user_id != ?',
      [username.trim(), userId]
    );
    
    if (existing) {
      return { status: 'failed', message: 'Username already exists' };
    }

    const userLevel = user_level === "admin" ? "admin" : "user";
    
    await dbRun(
      'UPDATE users SET username = ?, user_level = ? WHERE user_id = ?',
      [username.trim(), userLevel, userId]
    );

    addLog('User Management', `User ID ${userId} updated - username: ${username}, level: ${userLevel}`);
    
    return { status: 'success', message: 'User updated successfully' };
  } catch (error) {
    console.error('Error updating user:', error);
    return { status: 'failed', message: 'Error occurred while updating user' };
  }
}

async function deleteUser(userId) {
  try {
    // Check if user exists
    const user = await dbGet('SELECT username FROM users WHERE user_id = ?', [userId]);
    if (!user) {
      return { status: 'failed', message: 'User not found' };
    }

    // Prevent deletion of the last admin user
    const adminCount = await dbGet('SELECT COUNT(*) as count FROM users WHERE user_level = "admin"');
    const userToDelete = await dbGet('SELECT user_level FROM users WHERE user_id = ?', [userId]);
    
    if (userToDelete.user_level === 'admin' && adminCount.count <= 1) {
      return { status: 'failed', message: 'Cannot delete the last admin user' };
    }

    await dbRun('DELETE FROM users WHERE user_id = ?', [userId]);
    
    addLog('User Management', `User deleted: ${user.username}`);
    
    return { status: 'success', message: 'User deleted successfully' };
  } catch (error) {
    console.error('Error deleting user:', error);
    return { status: 'failed', message: 'Error occurred while deleting user' };
  }
}

module.exports = { 
  authenticateUser, 
  getAllUsers, 
  addUser, 
  updateUsername, 
  updatePassword,
  updateUser,
  deleteUser
};
