require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors());
app.use(express.json());

// ─── MySQL connection ─────────────────────────────────────────────────────────
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root@123",
    database: "disaster_management"
});

db.connect((err) => {
    if (err) {
        console.log("Database connection error:", err);
    } else {
        console.log("✅ MySQL Connected");
    }
});

// ─── Nodemailer Config (Email OTP) ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Helper: send OTP via Email (Nodemailer)
async function sendOTPEmail(email, otp, name) {
    console.log(`\n📧 Sending OTP [${otp}] to email: ${email}`);

    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Disaster Management System - Login OTP",
            text: `Hello ${name},\n\nYour OTP for Disaster Management System login is: ${otp}.\n\nValid for 5 minutes. Do not share this with anyone.\n\nThank you.`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("✅ EMAIL SENT SUCCESSFULLY:", info.response);
        return true;
    } catch (err) {
        console.error("❌ EMAIL ERROR:", err.message);
        console.log(`[DEV FALLBACK] OTP for ${email}: ${otp}`);
        return false;
    }
}

// Helper: generate 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── ROOT ROUTE ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.send("Backend running — Phase 2 (Email OTP via Nodemailer)");
});

// ─── TEST EMAIL ROUTE ────────────────────────────────────────────────────────
// Visit: http://localhost:5000/test-email?email=YOUR_EMAIL_ADDRESS
app.get("/test-email", async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).send("❌ Provide ?email=YOUR_EMAIL_ADDRESS in the URL");
    console.log("Test email route hit for:", email);
    const sent = await sendOTPEmail(email, "123456", "Test");
    if (sent) {
        res.send("✅ Test email sent to " + email + "! Check your inbox.");
    } else {
        res.status(500).send("❌ Email failed. Check the backend console for details.");
    }
});

// ─── SUBMIT REQUEST ──────────────────────────────────────────────────────────
app.post("/request", async (req, res) => {
    console.log("Received POST /request:", req.body);
    const { org_name, disaster_name, resource_name, quantity, priority } = req.body;
    const promiseDb = db.promise();

    try {
        let [orgRows] = await promiseDb.query("SELECT org_id FROM Organization WHERE org_name = ?", [org_name]);
        let org_id;
        if (orgRows.length > 0) {
            org_id = orgRows[0].org_id;
        } else {
            const [result] = await promiseDb.query("INSERT INTO Organization (org_name, org_type) VALUES (?, ?)", [org_name, 'NGO']);
            org_id = result.insertId;
        }

        let [disRows] = await promiseDb.query("SELECT disaster_id FROM Disaster WHERE disaster_type = ?", [disaster_name]);
        let disaster_id;
        if (disRows.length > 0) {
            disaster_id = disRows[0].disaster_id;
        } else {
            const [result] = await promiseDb.query("INSERT INTO Disaster (disaster_type, severity_level, location_id) VALUES (?, ?, ?)", [disaster_name, 'Medium', 1]);
            disaster_id = result.insertId;
        }

        let [resRows] = await promiseDb.query("SELECT resource_id FROM Resource WHERE resource_name = ?", [resource_name]);
        let resource_id;
        if (resRows.length > 0) {
            resource_id = resRows[0].resource_id;
        } else {
            const [result] = await promiseDb.query("INSERT INTO Resource (resource_name, resource_type, quantity_available) VALUES (?, ?, ?)", [resource_name, 'Relief', 100]);
            resource_id = result.insertId;
        }

        const sql = `
          INSERT INTO Resource_Request
          (org_id, disaster_id, resource_id, quantity_requested, priority_level)
          VALUES (?, ?, ?, ?, ?)
        `;
        await promiseDb.query(sql, [org_id, disaster_id, resource_id, quantity, priority]);
        res.status(200).json({ status: "success", message: "Request stored successfully" });
    } catch (err) {
        console.error("Error processing request:", err);
        res.status(500).json({ status: "error", message: "Server error handling request", error: err });
    }
});

// ─── GET ALL REQUESTS ─────────────────────────────────────────────────────────
app.get("/requests", (req, res) => {
    const sql = `
        SELECT 
            r.request_id,
            o.org_name,
            d.disaster_type as disaster_name,
            res.resource_name as resource_requested,
            r.quantity_requested,
            r.priority_level,
            v_form.actual_risk_level,
            r.request_status,
            r.request_time,
            r.verified_status,
            r.admin_approval,
            r.assigned_fvo,
            v.name as fvo_name
        FROM Resource_Request r
        LEFT JOIN Organization o ON r.org_id = o.org_id
        LEFT JOIN Disaster d ON r.disaster_id = d.disaster_id
        LEFT JOIN Resource res ON r.resource_id = res.resource_id
        LEFT JOIN Verification_Officer v ON r.assigned_fvo = v.fvo_id
        LEFT JOIN Verification v_form ON r.request_id = v_form.request_id
        ORDER BY r.request_time DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching requests:", err);
            res.status(500).json({ status: "error", message: "Failed to fetch requests", error: err });
        } else {
            res.status(200).json(results);
        }
    });
});

// ─── GET ALL RESOURCES ────────────────────────────────────────────────────────
app.get("/resources", (req, res) => {
    db.query("SELECT * FROM Resource", (err, results) => {
        if (err) res.status(500).json({ status: "error", message: "Failed to fetch resources", error: err });
        else res.status(200).json(results);
    });
});

// ─── GET ALL ALLOCATIONS ──────────────────────────────────────────────────────
app.get("/allocations", (req, res) => {
    db.query("SELECT * FROM Allocation", (err, results) => {
        if (err) res.status(500).json({ status: "error", message: "Failed to fetch allocations", error: err });
        else res.status(200).json(results);
    });
});

// ─── GET ALL ORGANIZATIONS ────────────────────────────────────────────────────
app.get("/organizations", (req, res) => {
    db.query("SELECT * FROM Organization", (err, results) => {
        if (err) res.status(500).json({ status: "error", message: "Failed to fetch organizations", error: err });
        else res.status(200).json(results);
    });
});

// ─── GET ALL DISASTERS ────────────────────────────────────────────────────────
app.get("/disasters", (req, res) => {
    db.query("SELECT * FROM Disaster", (err, results) => {
        if (err) res.status(500).json({ status: "error", message: "Failed to fetch disasters", error: err });
        else res.status(200).json(results);
    });
});

// ─── REGISTER (bcrypt + phone) ────────────────────────────────────────────────
app.post("/register", async (req, res) => {
    const { name, email, phone, password, role } = req.body;
    const promiseDb = db.promise();
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO Users (name, email, phone, username, password, role) VALUES (?, ?, ?, ?, ?, ?)";
        await promiseDb.query(sql, [name, email, phone || null, email, hashedPassword, role]);
        res.status(200).json({ status: "success", message: "User registered successfully" });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ status: "error", message: "Email already exists" });
        } else {
            console.error("Register Error:", err);
            res.status(500).json({ status: "error", message: "Server error", error: err });
        }
    }
});

// ─── LOGIN Step 1 — validate credentials + send SMS OTP ──────────────────────
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`\n🔐 Login attempt — email: ${email}`);
    const promiseDb = db.promise();

    try {
        const [rows] = await promiseDb.query("SELECT * FROM Users WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.status(401).json({ status: "error", message: "Invalid email or password" });
        }

        const user = rows[0];

        // Verify password (supports both bcrypt and legacy plain text)
        let passwordMatch = false;
        if (user.password && user.password.startsWith("$2b$")) {
            passwordMatch = await bcrypt.compare(password, user.password);
        } else {
            passwordMatch = (password === user.password);
        }

        if (!passwordMatch) {
            return res.status(401).json({ status: "error", message: "Invalid email or password" });
        }

        // Check if email is registered (it should be, since we queried by it)
        if (!user.email) {
            return res.status(400).json({
                status: "error",
                message: "No email registered for this account."
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const expiry = new Date(Date.now() + 5 * 60 * 1000);

        await promiseDb.query(
            "UPDATE Users SET otp = ?, otp_expiry = ? WHERE user_id = ?",
            [otp, expiry, user.user_id]
        );

        // Send OTP via Email
        await sendOTPEmail(user.email, otp, user.name || user.username || "User");

        // Mask email for safe display: e.g. a***b@gmail.com
        const [localPart, domain] = user.email.split('@');
        const maskedEmail = localPart.length > 2 
            ? `${localPart.slice(0, 2)}${'*'.repeat(localPart.length - 2)}@${domain}`
            : `${localPart}@${domain}`;

        res.status(200).json({
            status: "otp_required",
            message: `OTP sent to your registered email (${maskedEmail})`,
            email: user.email,
            email_hint: maskedEmail
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ status: "error", message: "Server error during login", error: err });
    }
});

// ─── VERIFY OTP Step 2 — complete login ──────────────────────────────────────
app.post("/verify-otp", async (req, res) => {
    const { email, otp } = req.body;
    const promiseDb = db.promise();

    try {
        const [rows] = await promiseDb.query(
            "SELECT * FROM Users WHERE email = ? AND otp = ?",
            [email, otp]
        );

        if (rows.length === 0) {
            return res.status(401).json({ status: "error", message: "Invalid OTP. Please try again." });
        }

        const user = rows[0];
        const now = new Date();
        const expiry = new Date(user.otp_expiry);

        if (now > expiry) {
            await promiseDb.query("UPDATE Users SET otp = NULL, otp_expiry = NULL WHERE user_id = ?", [user.user_id]);
            return res.status(401).json({ status: "error", message: "OTP has expired. Please login again." });
        }

        // Clear OTP after successful one-time use
        await promiseDb.query("UPDATE Users SET otp = NULL, otp_expiry = NULL WHERE user_id = ?", [user.user_id]);

        res.status(200).json({
            status: "success",
            message: "Login successful",
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (err) {
        console.error("OTP Verify Error:", err);
        res.status(500).json({ status: "error", message: "Server error during OTP verification", error: err });
    }
});

// ─── GET FVOs ─────────────────────────────────────────────────────────────────
app.get("/fvos", (req, res) => {
    db.query("SELECT * FROM Verification_Officer", (err, results) => {
        if (err) res.status(500).json({ error: err });
        else res.status(200).json(results);
    });
});

// ─── ASSIGN FVO ───────────────────────────────────────────────────────────────
app.post("/assignFVO", (req, res) => {
    const { request_id, fvo_id } = req.body;
    const sql = `UPDATE Resource_Request SET assigned_fvo = ?, verified_status = 'Pending' WHERE request_id = ?`;
    db.query(sql, [fvo_id, request_id], (err) => {
        if (err) res.status(500).json({ status: "error", error: err });
        else res.status(200).json({ status: "success", message: "FVO assigned" });
    });
});

// ─── GET FVO REQUESTS ─────────────────────────────────────────────────────────
app.get("/fvoRequests", (req, res) => {
    const fvo_id = req.query.fvo_id;
    const sql = `
        SELECT 
            r.request_id,
            o.org_name,
            d.disaster_type as disaster_name,
            res.resource_name as resource_requested,
            r.quantity_requested,
            r.priority_level,
            r.verified_status
        FROM Resource_Request r
        LEFT JOIN Organization o ON r.org_id = o.org_id
        LEFT JOIN Disaster d ON r.disaster_id = d.disaster_id
        LEFT JOIN Resource res ON r.resource_id = res.resource_id
        WHERE r.assigned_fvo = ?
    `;
    db.query(sql, [fvo_id], (err, results) => {
        if (err) res.status(500).json({ status: "error", error: err });
        else res.status(200).json(results);
    });
});

// ─── FVO VERIFY REQUEST ───────────────────────────────────────────────────────
app.post("/verifyRequest", (req, res) => {
    const { request_id, fvo_id, actual_risk_level, remarks } = req.body;
    const insertSQL = `INSERT INTO Verification (request_id, fvo_id, actual_risk_level, remarks, verification_status) VALUES (?, ?, ?, ?, 'Verified')`;
    db.query(insertSQL, [request_id, fvo_id, actual_risk_level, remarks], (err) => {
        if (err) {
            res.status(500).json({ status: "error", error: err });
        } else {
            const updateSQL = `UPDATE Resource_Request SET verified_status = 'Verified' WHERE request_id = ?`;
            db.query(updateSQL, [request_id], (err2) => {
                if (err2) res.status(500).json({ status: "error", error: err2 });
                else res.status(200).json({ status: "success", message: "Verification submitted" });
            });
        }
    });
});

// ─── ADMIN APPROVE/REJECT ─────────────────────────────────────────────────────
app.post("/approveRequest", (req, res) => {
    const { request_id, admin_approval } = req.body;
    const sql = `UPDATE Resource_Request SET admin_approval = ? WHERE request_id = ?`;
    db.query(sql, [admin_approval, request_id], (err) => {
        if (err) res.status(500).json({ status: "error", error: err });
        else res.status(200).json({ status: "success", message: `Request ${admin_approval}` });
    });
});

// ─── ALLOCATE RESOURCE (concurrency-safe via stored procedure) ────────────────
app.post("/allocate", (req, res) => {
    const { request_id } = req.body;
    db.query("CALL allocate_resource(?)", [request_id], (err, results) => {
        if (err) {
            console.error("Allocation Error:", err);
            res.status(400).json({
                status: "error",
                message: err.sqlMessage || "Allocation failed (insufficient resources, trigger restriction, or concurrency conflict)"
            });
        } else {
            res.status(200).json({ status: "success", message: "Resource successfully allocated" });
        }
    });
});

app.listen(5000, () => {
    console.log("🚀 Server running on port 5000 — Phase 2 (Email OTP via Nodemailer)");
});