module.exports = function(RED) {
    // Helper to parse configured output values from strings
    function parseOutValue(type, valueStr) {
        const strValue = String(valueStr); // Ensure string type for checks

        if (type === 'num') {
            const num = Number.parseFloat(strValue);

            return !Number.isNaN(num) ? num : undefined;
        }
        if (type === 'bool') {
            if (strValue === 'true') return true;
            if (strValue === 'false') return false;
            
            return undefined;
        }
        if (strValue === 'null') {
            return null;
        }
        
        return strValue; // Default to string
    }

    function HysteresisNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // --- Configuration Processing & Validation ---
        const name = config.name;
        const thresholdType = config.ThresholdType || 'fixed';
        const initialMessageFlag = config.InitialMessage === true || config.InitialMessage === 'true';
        const dynRaiseError = config.DynRaiseError === true || config.DynRaiseError === 'true';
        const topicThreshold = config.TopicThreshold;
        const topicCurrent = config.TopicCurrent;
        const outRisingType = config.OutRisingType;
        const outRisingValueStr = config.OutRisingValue;
        const outFallingType = config.OutFallingType;
        const outFallingValueStr = config.OutFallingValue;
        const outTopicType = config.OutTopicType;
        const outTopicValue = config.OutTopicValue;
        const outRisingValueParsed = outRisingType !== 'pay' ? parseOutValue(outRisingType, outRisingValueStr) : undefined;
        const outFallingValueParsed = outFallingType !== 'pay' ? parseOutValue(outFallingType, outFallingValueStr) : undefined;

        // --- State Variables ---
        const nodeContext = node.context();
        let rising = Number.NaN; 
        let falling = Number.NaN; 
        let thresholdsValid = false;
        let deltaR = Number.NaN; 
        let deltaF = Number.NaN;
        // Load persistent state, initialize direction to null if not found
        

        node.direction = nodeContext.get('Direction') || null; // Can be 'high', 'low', 'deadband', or null
        node.lastValue = nodeContext.get('LastValue');

        // --- Initialize Thresholds based on Mode ---
        if (thresholdType === 'fixed') {
            const tr = Number.parseFloat(config.ThresholdRising);
            const tf = Number.parseFloat(config.ThresholdFalling);

            if (!Number.isNaN(tr) && !Number.isNaN(tf) && tr > tf) {
                rising = tr; falling = tf; thresholdsValid = true;
            } else {
                node.warn('Invalid fixed thresholds configured.'); 
            }
        } else { // Dynamic mode
            deltaR = Number.parseFloat(config.ThresholdDeltaRising);
            deltaF = Number.parseFloat(config.ThresholdDeltaFalling);
            if (Number.isNaN(deltaR) || Number.isNaN(deltaF) || deltaR < 0 || deltaF < 0) {
                node.warn(`Invalid dynamic deltas (D+='${config.ThresholdDeltaRising}', D-='${config.ThresholdDeltaFalling}'). Must be non-negative numbers.`);
                deltaR = Number.NaN; deltaF = Number.NaN; // Ensure invalid
            } else if (!topicThreshold) {
                node.warn('Dynamic mode selected but no Threshold Topic configured.');
            }
            if (topicThreshold) {
                node.warn(`Dynamic thresholds must be resent via topic '${topicThreshold}' after deploy/restart.`);
            }
            // thresholdsValid remains false until first dynamic update
        }

        // --- Set Initial Visual Status ---
        // (More detailed status set within input handler)
        if (!thresholdsValid && thresholdType === 'fixed') {
            node.status({ fill: 'red', shape: 'ring', text: 'Error: Invalid Fixed Thresholds' });
        } else if (!thresholdsValid && thresholdType === 'dynamic' && (Number.isNaN(deltaR) || Number.isNaN(deltaF))) {
            node.status({ fill: 'red', shape: 'ring', text: 'Error: Invalid Deltas' });
        } else if (!thresholdsValid && thresholdType === 'dynamic') {
            node.status({ fill: 'yellow', shape: 'ring', text: 'waiting for threshold topic' });
        } else if (node.direction === null) {
            node.status({ fill: 'grey', shape: 'ring', text: 'waiting for input' });
        } else { // Restore status based on persisted state
            const stateText = node.direction === 'deadband' ? 'Deadband' : (node.direction === 'high' ? 'High' : 'Low');
            const shape = node.direction === 'deadband' ? 'ring' : 'dot';
            const fill = node.direction === 'high' ? 'green' : (node.direction === 'low' ? 'blue' : 'yellow');

            node.status({ fill, shape, text: `R:${rising} F:${falling} (${stateText})` });
        }


        // --- Input Message Handler ---
        node.on('input', (msg, send, done) => {
            const payload = Number.parseFloat(msg.payload);

            if (Number.isNaN(payload)) {
                return done(); 
            }

            // --- 1. Handle Dynamic Threshold Update ---
            if (thresholdType === 'dynamic' && msg.topic === topicThreshold) {
                if (Number.isNaN(deltaR) || Number.isNaN(deltaF)) {
                    node.warn('Cannot update dynamic thresholds: Invalid deltas configured.'); 
                } else {
                    const centerValue = payload;
                    const newRising = centerValue + deltaR;
                    const newFalling = centerValue - deltaF;

                    if (newRising > newFalling) {
                        rising = newRising; falling = newFalling; thresholdsValid = true;
                        node.log(`Dynamic thresholds updated: R=${rising}, F=${falling}`);
                        node.status({ fill: 'yellow', shape: 'ring', text: `${falling}/--/${rising}` });
                    } else {
                        thresholdsValid = false; rising = Number.NaN; falling = Number.NaN;
                        node.status({ fill: 'red', shape: 'dot', text: 'invalid calculated thresholds' });
                        node.warn(`Dynamic calc invalid: Upper (${newRising}) !> Lower (${newFalling}).`);
                    }
                }
                
                return done(); // Stop processing for threshold updates
            }

            // --- 2. Check if Thresholds are Valid Before Value Processing ---
            if (!thresholdsValid) {
                if (thresholdType === 'dynamic' && msg.topic === topicCurrent) {
                    if (dynRaiseError) {
                        const err = new Error(`Hysteresis check failed: Dynamic thresholds not established or invalid.`);

                        node.status({ fill: 'red', shape: 'ring', text: 'Error: Thresholds missing' });
                        if (done) {
                            done(err); 
                        } else {
                            node.error(err, msg); 
                        }
                        
                        return;
                    } else {
                        node.warn(`Ignoring input value on topic '${topicCurrent}': Dynamic thresholds not established or invalid.`); 
                    }
                } else if (thresholdType === 'fixed') {
                    node.warn('Ignoring input value: Fixed thresholds are invalid.'); 
                }
                
                return done(); // Cannot process value if thresholds invalid
            }

            // --- 3. Check if Message is the Value Input ---
            const isValueInput = (thresholdType === 'fixed') || (thresholdType === 'dynamic' && msg.topic === topicCurrent);

            if (!isValueInput) {
                return done(); 
            }

            // --- 4. Core Hysteresis Logic ---
            const previousValue = node.lastValue;
            // isInitial: check if direction is null (never set)
            const isInitial = node.direction === null;
            const currentDirection = node.direction; // 'high', 'low', 'deadband', or null
            let newDirection = null; // Determined new state ('high', 'low', 'deadband')
            let messageToSend = null; // Prepared output message
            let statusOptions = null; // Specific status for this input

            // --- Determine State / Action ---
            if (isInitial) {
                // First value processing
                if (payload >= rising) {
                    newDirection = 'high';
                    statusOptions = { fill: 'green', shape: 'dot', text: `${falling}/${payload}/${rising} (initial high band)` };
                } else if (payload <= falling) {
                    newDirection = 'low';
                    statusOptions = { fill: 'blue', shape: 'dot', text: `${falling}/${payload}/${rising} (initial low band)` };
                } else {
                    // Initial value is in the dead band - SET state to deadband
                    newDirection = 'deadband'; // Explicitly set initial deadband state
                    node.lastValue = payload;
                    nodeContext.set('LastValue', node.lastValue);
                    node.direction = newDirection; // Update internal state
                    nodeContext.set('Direction', node.direction); // Persist deadband state
                    node.status({ fill: 'yellow', shape: 'ring', text: `${falling}/${payload}/${rising} (Initial Deadband)` });
                    
                    return done(); // Stop processing, no output sent
                }
                // If initial state is high or low, prepare the message
                if (newDirection === 'high' || newDirection === 'low') {
                    const msgNew = RED.util.cloneMessage(msg);

                    if (outTopicType === 'str' && typeof outTopicValue === 'string') {
                        msgNew.topic = outTopicValue; 
                    }
                    msgNew.payload = (newDirection === 'high') ? (outRisingType === 'pay' ? payload : outRisingValueParsed) : (outFallingType === 'pay' ? payload : outFallingValueParsed);
                    msgNew.hystdirection = `initial ${newDirection}`;
                    messageToSend = msgNew;
                }
            } else { // Standard processing (node.direction is 'high', 'low', or 'deadband')
                // Check for state-changing threshold crossings (INCLUDING from 'deadband')
                if ((currentDirection === 'low' || currentDirection === 'deadband') && payload >= rising) {
                    newDirection = 'high';
                    statusOptions = { fill: 'green', shape: 'dot', text: `${falling}/${payload}/${rising} (high band)` };
                } else if ((currentDirection === 'high' || currentDirection === 'deadband') && payload <= falling) {
                    newDirection = 'low';
                    statusOptions = { fill: 'blue', shape: 'dot', text: `${falling}/${payload}/${rising} (low band)` };
                }

                // If state changed, prepare output message
                if (newDirection !== null) {
                    const msgNew = RED.util.cloneMessage(msg);

                    if (outTopicType === 'str' && typeof outTopicValue === 'string') {
                        msgNew.topic = outTopicValue; 
                    }
                    msgNew.payload = (newDirection === 'high') ? (outRisingType === 'pay' ? payload : outRisingValueParsed) : (outFallingType === 'pay' ? payload : outFallingValueParsed);
                    // Direction is just 'high' or 'low' for subsequent changes
                    msgNew.hystdirection = newDirection;
                    messageToSend = msgNew;
                } else {
                    // --- No State Change - Set Detailed Status (like original) ---
                    // Only provide detailed rising/falling if current state is high or low
                    if (currentDirection === 'high' || currentDirection === 'low') {
                        const isRising = (typeof previousValue === 'number' && payload > previousValue);
                        const isFalling = (typeof previousValue === 'number' && payload < previousValue);
                        const moveText = isRising ? 'rising' : (isFalling ? 'falling' : 'steady'); // Add steady case
                        const directionText = currentDirection; // 'high' or 'low'
                        const fillColor = currentDirection === 'high' ? 'green' : 'blue';

                        if (payload >= rising || payload <= falling) { // Still outside dead band
                            statusOptions = { fill: fillColor, shape: 'dot', text: `${falling}/${payload}/${rising} (${directionText} band ${moveText})` };
                        } else { // Inside dead band (but state didn't change)
                            statusOptions = { fill: fillColor, shape: 'ring', text: `${falling}/${payload}/${rising} (${directionText} dead band ${moveText})` };
                        }
                    } else if (currentDirection === 'deadband') {
                        // If still in deadband after starting in deadband
                        statusOptions = { fill: 'yellow', shape: 'ring', text: `${falling}/${payload}/${rising} (Deadband)` };
                    }

                    // Update status, last value, and finish (no message sent)
                    if (statusOptions) node.status(statusOptions);
                    node.lastValue = payload;
                    nodeContext.set('LastValue', node.lastValue);
                    
                    return done();
                }
            }

            // --- 5. Send Output (Conditionally based on InitialMessage flag) ---
            let shouldSend = false;

            if (messageToSend !== null) { // A message was prepared (threshold crossed)
                // Only apply flag if it was the very first determination (isInitial was true)
                shouldSend = isInitial ? initialMessageFlag : true;
            }

            if (shouldSend) {
                send(messageToSend);
            }

            // --- 6. Update State & Persistence (if direction determined/changed) ---
            if (newDirection !== null) {
                node.direction = newDirection; // Update in-memory state ('high' or 'low' only here)
                // Persist direction state *only if it changed* from previous state (could be null, deadband, high, low)
                if (newDirection !== currentDirection) {
                    nodeContext.set('Direction', node.direction);
                }
            }
            // Always update and persist last value processed
            node.lastValue = payload;
            nodeContext.set('LastValue', node.lastValue);

            // Set final status for this message processing
            if (statusOptions) { // Use status determined earlier
                node.status(statusOptions);
            } else if (newDirection) { // Fallback if statusOptions wasn't set but state changed (shouldn't happen)
                node.status({ fill: 'grey', shape: 'dot', text: `processed - ${newDirection}` });
            }

            // Finalize
            if (done) {
                done(); 
            }
        }); // End node.on('input')

        // --- Node Closure ---
        node.on('close', (removed, done) => {
            node.log('Hysteresis node stopped.');
            node.status({}); // Clear status
            done();
        });
    } // End HysteresisNode constructor

    RED.nodes.registerType('hysteresis', HysteresisNode);
}; // End module.exports
