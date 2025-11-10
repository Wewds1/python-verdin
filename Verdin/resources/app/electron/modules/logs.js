const db = require('../model/db');
const fs = require('fs');


function getAllLogs() {
    return new Promise((resolve) => {
        db.all('SELECT * FROM logs ORDER BY log_timestamp DESC', (err, rows) => {
            if (err) {
                return resolve({ message: 'Error fetching logs' });
            }
        
            if (rows.length === 0) {
                return resolve({ message: 'No logs found' });
            }

            return resolve(rows);
        });
    })
}

function addLog(log_type, description){
    return new Promise((resolve) => {
        db.run('INSERT INTO logs(log_type, description) VALUES (?, ?)', [log_type, description], function (err) {
            if (err) {
                console.error('Error adding new log:', err.message);
                resolve();
            }

            const filePath = `./logs/log_${new Date().toISOString().split("T")[0]}.txt`;

            fs.appendFile(filePath, `${log_type} (${new Date().toLocaleString()}): ${description}\n`, (err) => {
                if (err) {
                    console.error('Error appending to file:', err);
                }
            });
    
            resolve();
        });
    })
}

module.exports = { getAllLogs, addLog };