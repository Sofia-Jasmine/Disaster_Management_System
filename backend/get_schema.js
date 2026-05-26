const mysql = require("mysql2");
const fs = require("fs");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root@123",
    database: "disaster_management"
});

db.connect(async (err) => {
    if (err) return console.log(err);
    
    db.query("SELECT * FROM Organization", (err, res1) => {
        db.query("SELECT * FROM Disaster", (err, res2) => {
            db.query("SELECT * FROM Resource", (err, res3) => {
                fs.writeFileSync("data.json", JSON.stringify({
                    Organization: res1,
                    Disaster: res2,
                    Resource: res3
                }, null, 2));
                process.exit();
            });
        });
    });
});
