const db = require('../model/db');

async function getAllClients() {
    try {
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM clients', (err, rows) => {
          if (err) {
            return reject({ message: 'Error fetching clients' });
          }
          resolve(rows);
        });
      });
      
      if (rows.length === 0) {
        return { message: 'No clients found' };
      }
      
      const output = [];
      for (const client of rows) {
        const count = await getCCTVCount(client.client_id);
        output.push({
          client_id: client.client_id,
          client_name: client.client_name,
          camera_count: count
        });
      }
      
      return output;
    } catch (error) {
      throw error;
    }
}
  
  

function getCCTVCount(client_id) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT COUNT(*) AS count FROM sources WHERE client_id = ?',
            [client_id],
            (err, row) => {
                if (err) {
                console.error(err);
                return reject(err);
                }
                resolve(row.count);
            }
        );
    });
}
  

function addClient(client_name){
    return new Promise((resolve) => {
        db.all('SELECT * FROM clients WHERE client_name=?', [client_name], (err, rows) => {
            if (err) {
                return resolve({ status: 'failed', message: 'Error fetching clients' });
            }
        
            if (rows.length > 0) {
                return resolve({ status: 'failed', message: 'Client already exist' });
            }
    
            db.run('INSERT INTO clients(client_name) VALUES (?)', [client_name], function (err) {
                if (err) {
                    console.error('Error adding new client:', err.message);
                    return resolve({ status: 'failed', message: 'Error adding new client' });
                }
        
                return resolve({ status: 'success', message: 'Successfully added new client' });
            });
        });
    })
}

async function deleteClient(client_id) {
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('DELETE FROM clients WHERE client_id = ?', [client_id], function (err) {
        if (err) {
          return reject(err);
        }
        // You can also check how many rows were affected via this.changes if needed.
        resolve({ status: 'success', message: 'Client has been deleted', changes: this.changes });
      });
    });
    return result;
  } catch (error) {
    console.error(error);
    return { status: 'failed', message: 'Error deleting client' };
  }
}

async function updateClient(client_id, client_name) {
  try {
    // First check if the new name already exists for a different client
    const existingClient = await new Promise((resolve, reject) => {
      db.get('SELECT client_id FROM clients WHERE client_name = ? AND client_id != ?', [client_name, client_id], (err, row) => {
        if (err) {
          return reject(err);
        }
        resolve(row);
      });
    });

    if (existingClient) {
      return { status: 'failed', message: 'Client name already exists' };
    }

    // Update the client
    const result = await new Promise((resolve, reject) => {
      db.run('UPDATE clients SET client_name = ? WHERE client_id = ?', [client_name, client_id], function (err) {
        if (err) {
          return reject(err);
        }
        resolve({ status: 'success', message: 'Client updated successfully', changes: this.changes });
      });
    });

    if (result.changes === 0) {
      return { status: 'failed', message: 'Client not found' };
    }

    return result;
  } catch (error) {
    console.error('Error updating client:', error);
    return { status: 'failed', message: 'Error updating client' };
  }
}

module.exports = { getAllClients, addClient, deleteClient, updateClient };