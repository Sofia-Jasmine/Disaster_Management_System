-- Phase 2 SQL Migration Script
-- Adding tables for Users, Verification_Officer, Verification
-- Modifying Resource_Request and Organization tables
-- Creating Stored Procedure and Triggers

CREATE TABLE IF NOT EXISTS Users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'USER', 'FVO') NOT NULL,
    linked_org_id INT
);

CREATE TABLE IF NOT EXISTS Verification_Officer (
    fvo_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) NOT NULL,
    assigned_area VARCHAR(100),
    availability_status VARCHAR(20) DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS Verification (
    verification_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT,
    fvo_id INT,
    actual_risk_level ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    remarks TEXT,
    verification_status VARCHAR(20) DEFAULT 'Pending',
    verification_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (fvo_id) REFERENCES Verification_Officer(fvo_id)
);

-- Note: We add foreign keys ignoring existing ones if this is a rerun, but to be safe we just run standard Alter table
-- MySQL 8.0 doesn't have an easy IF NOT EXISTS for adding columns outside of stored procedures, but let's assume it doesn't exist yet.

-- Add columns to Resource_Request
-- If they already exist, this will error. So I'll put them in a way that ignores errors by executing via a stored procedure if necessary, but simple script is fine for first try.

DELIMITER ^^
CREATE PROCEDURE try_add_columns()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    ALTER TABLE Resource_Request ADD COLUMN assigned_fvo INT;
    ALTER TABLE Resource_Request ADD COLUMN verified_status VARCHAR(20) DEFAULT 'Pending';
    ALTER TABLE Resource_Request ADD COLUMN admin_approval VARCHAR(20) DEFAULT 'Pending';
    ALTER TABLE Resource_Request ADD CONSTRAINT fk_assigned_fvo FOREIGN KEY (assigned_fvo) REFERENCES Verification_Officer(fvo_id);
    ALTER TABLE Organization ADD COLUMN trust_score INT DEFAULT 50;
    ALTER TABLE Verification ADD CONSTRAINT fk_verification_req FOREIGN KEY (request_id) REFERENCES Resource_Request(request_id);
END^^
DELIMITER ;
CALL try_add_columns();
DROP PROCEDURE try_add_columns;

-- Stored Procedure allocate_resource
DELIMITER //
DROP PROCEDURE IF EXISTS allocate_resource //
CREATE PROCEDURE allocate_resource(IN p_request_id INT)
BEGIN
    DECLARE v_resource_id INT;
    DECLARE v_quantity_req INT;
    DECLARE v_quantity_avail INT;
    DECLARE v_status VARCHAR(20);
    DECLARE v_admin_approval VARCHAR(20);
    DECLARE act_priority VARCHAR(20);
    
    -- Transaction for ACID Compliance
    START TRANSACTION;
    
    SELECT resource_id, quantity_requested, request_status, admin_approval, priority_level 
    INTO v_resource_id, v_quantity_req, v_status, v_admin_approval, act_priority
    FROM Resource_Request WHERE request_id = p_request_id FOR UPDATE;
    
    IF v_status = 'Completed' THEN
        ROLLBACK;
    ELSEIF v_admin_approval != 'Approved' THEN
        ROLLBACK;
    ELSE
        SELECT quantity_available INTO v_quantity_avail 
        FROM Resource WHERE resource_id = v_resource_id FOR UPDATE;
        
        IF v_quantity_avail >= v_quantity_req THEN
            UPDATE Resource SET quantity_available = quantity_available - v_quantity_req WHERE resource_id = v_resource_id;
            
            INSERT INTO Allocation (request_id, resource_id, quantity_allocated) VALUES (p_request_id, v_resource_id, v_quantity_req);
            
            UPDATE Resource_Request SET request_status = 'Completed' WHERE request_id = p_request_id;
            
            COMMIT;
        ELSE
            ROLLBACK;
        END IF;
    END IF;
END //

-- Triggers
DROP TRIGGER IF EXISTS trg_priority_conflict //
CREATE TRIGGER trg_priority_conflict
BEFORE INSERT ON Allocation
FOR EACH ROW
BEGIN
    DECLARE v_priority VARCHAR(20);
    DECLARE v_high_count INT;
    DECLARE v_resource_id INT;
    
    SELECT priority_level, resource_id INTO v_priority, v_resource_id
    FROM Resource_Request WHERE request_id = NEW.request_id;
    
    IF v_priority IN ('LOW', 'MEDIUM', 'Low', 'Medium') THEN
        -- Check if there are any Pending/Approved HIGH requests for the same resource
        SELECT COUNT(*) INTO v_high_count
        FROM Resource_Request
        WHERE resource_id = v_resource_id 
          AND priority_level = 'HIGH' 
          AND request_status != 'Completed';
          
        IF v_high_count > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot allocate to LOW/MEDIUM priority when HIGH priority requests exist for this resource';
        END IF;
    END IF;
END //

DROP TRIGGER IF EXISTS trg_trust_score //
CREATE TRIGGER trg_trust_score
AFTER INSERT ON Allocation
FOR EACH ROW
BEGIN
    DECLARE v_org_id INT;
    SELECT org_id INTO v_org_id FROM Resource_Request WHERE request_id = NEW.request_id;
    
    IF v_org_id IS NOT NULL THEN
        UPDATE Organization SET trust_score = trust_score + 10 WHERE org_id = v_org_id;
    END IF;
END //
DELIMITER ;

-- Insert demo users if they don't exist
INSERT IGNORE INTO Users (username, password, role) VALUES ('admin', 'admin', 'ADMIN');
INSERT IGNORE INTO Users (username, password, role) VALUES ('fvo1', 'fvo123', 'FVO');
INSERT IGNORE INTO Users (username, password, role) VALUES ('fvo2', 'fvo123', 'FVO');
INSERT IGNORE INTO Users (username, password, role) VALUES ('user1', 'user123', 'USER');

-- Add dummy FVO
INSERT INTO Verification_Officer (name, phone, assigned_area) 
SELECT 'John (FVO)', '999999999', 'Downtown'
WHERE NOT EXISTS (SELECT 1 FROM Verification_Officer WHERE name = 'John (FVO)');

