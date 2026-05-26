DROP TRIGGER IF EXISTS trg_priority_conflict;

DELIMITER //
CREATE TRIGGER trg_priority_conflict
BEFORE INSERT ON Allocation
FOR EACH ROW
BEGIN
    DECLARE v_priority VARCHAR(20);
    DECLARE v_high_count INT;
    DECLARE v_resource_id INT;
    
    SELECT COALESCE(v_form.actual_risk_level, r.priority_level), r.resource_id 
    INTO v_priority, v_resource_id
    FROM Resource_Request r
    LEFT JOIN Verification v_form ON r.request_id = v_form.request_id
    WHERE r.request_id = NEW.request_id;
    
    IF v_priority IN ('LOW', 'MEDIUM', 'Low', 'Medium') THEN
        -- Check if there are any Pending/Approved HIGH requests for the same resource
        SELECT COUNT(*) INTO v_high_count
        FROM Resource_Request r
        LEFT JOIN Verification v_form ON r.request_id = v_form.request_id
        WHERE r.resource_id = v_resource_id 
          AND COALESCE(v_form.actual_risk_level, r.priority_level) = 'HIGH' 
          AND r.request_status != 'Completed'
          AND (r.admin_approval IS NULL OR r.admin_approval != 'Rejected');
          
        IF v_high_count > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot allocate to LOW/MEDIUM priority when valid HIGH priority requests exist for this resource';
        END IF;
    END IF;
END //
DELIMITER ;