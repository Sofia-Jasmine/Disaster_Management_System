-- ============================================================
-- PHASE 2 MIGRATION SCRIPT
-- Security + Redundancy + Concurrency improvements
-- ============================================================

-- 1. SECURITY: Add OTP fields to Users table
DELIMITER ^^
CREATE PROCEDURE add_otp_columns()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    ALTER TABLE Users ADD COLUMN otp VARCHAR(6) NULL;
    ALTER TABLE Users ADD COLUMN otp_expiry DATETIME NULL;
END^^
DELIMITER ;
CALL add_otp_columns();
DROP PROCEDURE add_otp_columns;

-- 2. REDUNDANCY: Ensure UNIQUE constraint on email (in case not applied yet)
DELIMITER ^^
CREATE PROCEDURE ensure_email_unique()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    ALTER TABLE Users ADD UNIQUE(email);
END^^
DELIMITER ;
CALL ensure_email_unique();
DROP PROCEDURE ensure_email_unique;

-- 3. REDUNDANCY: Ensure UNIQUE constraint on org_name
DELIMITER ^^
CREATE PROCEDURE ensure_orgname_unique()
BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
    ALTER TABLE Organization ADD UNIQUE(org_name);
END^^
DELIMITER ;
CALL ensure_orgname_unique();
DROP PROCEDURE ensure_orgname_unique;

-- 4. REDUNDANCY: Create Priority reference table (optional enhancement)
CREATE TABLE IF NOT EXISTS Priority (
    priority_id INT PRIMARY KEY,
    level VARCHAR(10) NOT NULL
);

INSERT IGNORE INTO Priority (priority_id, level) VALUES
    (1, 'LOW'),
    (2, 'MEDIUM'),
    (3, 'HIGH');











    

-- 5. CONCURRENCY: Update allocate_resource stored procedure with full transaction + row-level locking
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
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;













    
    -- Begin transaction for ACID compliance + concurrency safety
    START TRANSACTION;
    
    -- Lock the request row first (row-level lock)
    SELECT resource_id, quantity_requested, request_status, admin_approval, priority_level 
    INTO v_resource_id, v_quantity_req, v_status, v_admin_approval, act_priority
    FROM Resource_Request WHERE request_id = p_request_id FOR UPDATE;
    
    IF v_status = 'Completed' THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Request is already completed';
    ELSEIF v_admin_approval != 'Approved' THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Request has not been approved by admin';
    ELSE
        -- Lock the resource row (prevents concurrent over-allocation)
        SELECT quantity_available INTO v_quantity_avail 
        FROM Resource WHERE resource_id = v_resource_id FOR UPDATE;
        
        IF v_quantity_avail >= v_quantity_req THEN
            -- Safely deduct (prevents negative values)
            UPDATE Resource 
            SET quantity_available = quantity_available - v_quantity_req 
            WHERE resource_id = v_resource_id 
              AND quantity_available >= v_quantity_req;
            
            -- Verify update actually happened (race condition guard)
            IF ROW_COUNT() = 0 THEN
                ROLLBACK;
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient resources (concurrency conflict detected)';
            END IF;
            
            INSERT INTO Allocation (request_id, resource_id, quantity_allocated) 
            VALUES (p_request_id, v_resource_id, v_quantity_req);
            
            UPDATE Resource_Request SET request_status = 'Completed' WHERE request_id = p_request_id;
            
            COMMIT;
        ELSE
            ROLLBACK;
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient resources available for allocation';
        END IF;
    END IF;
END //

-- 6. Triggers (recreate with safety)
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
        SELECT COUNT(*) INTO v_high_count
        FROM Resource_Request
        WHERE resource_id = v_resource_id 
          AND priority_level IN ('HIGH', 'High')
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

-- 7. Update demo user passwords: store bcrypt hashes via application (NOT plain text)
-- NOTE: bcrypt hashing is done at the application layer (Node.js)
-- The migration only ensures schema is correct.
-- Demo accounts should be re-seeded via /register API or manually updated after hashing.

SELECT 'Phase 2 Migration Complete' AS status;
