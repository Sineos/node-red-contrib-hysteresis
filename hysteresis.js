module.exports = function (RED) {
    'use strict';

    function HysteresisNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // --- Configuration Processing & Validation ---
        const name = config.name;
        const thresholdType = config.ThresholdType || 'fixed';
        const initialMessageFlag = config.InitialMessage === true;
        const dynRaiseError = config.DynRaiseError === true;

        const thresholdRisingType = config.ThresholdRisingType || 'num';
        const thresholdRisingValue = config.ThresholdRising;
        const thresholdFallingType = config.ThresholdFallingType || 'num';
        const thresholdFallingValue = config.ThresholdFalling;

        const topicThreshold = config.TopicThreshold;
        const topicCurrent = config.TopicCurrent;
        let deltaR = parseFloat(config.ThresholdDeltaRising);
        let deltaF = parseFloat(config.ThresholdDeltaFalling);
        const deltasValid = !(Number.isNaN(deltaR) || Number.isNaN(deltaF) || deltaR < 0 || deltaF < 0);
        if (!deltasValid && thresholdType === 'dynamic') {
            node.warn(`Invalid dynamic threshold deltas configured (D+='${config.ThresholdDeltaRising}', D-='${config.ThresholdDeltaFalling}'). Must be non-negative numbers.`);
            deltaR = NaN; deltaF = NaN;
        } else if (thresholdType === 'dynamic' && !topicThreshold) {
            node.warn("Dynamic mode selected but no Threshold Topic configured.");
        }
        if (thresholdType === 'dynamic' && topicThreshold) {
            node.warn(`Dynamic thresholds must be resent via topic '${topicThreshold}' after deploy/restart.`);
        }

        const outRisingType = config.OutRisingType || 'pay';
        const outRisingValue = config.OutRisingValue;
        const outFallingType = config.OutFallingType || 'pay';
        const outFallingValue = config.OutFallingValue;
        const outTopicType = config.OutTopicType || 'msg'; // Output topic source: 'msg', 'str', etc.
        const outTopicValue = config.OutTopicValue;

        // --- State Variables ---
        const nodeContext = node.context();
        let dynamicRising = NaN;
        let dynamicFalling = NaN;
        let dynamicThresholdsValid = false;

        node.direction = nodeContext.get('Direction') ?? null;
        node.lastValue = nodeContext.get('LastValue') ?? null;

        // --- Status Tracking ---
        let lastStatusText = '';
        function setStatusSafely(status) {
            const newText = status?.text || '';
            if (newText !== lastStatusText) {
                node.status(status);
                lastStatusText = newText;
            }
        }
        setStatusSafely({ fill: 'grey', shape: 'ring', text: 'waiting for input' });

        // --- Input Message Handler ---
        node.on('input', function (msg, send, done) {

            const payload = parseFloat(msg.payload);
            if (Number.isNaN(payload)) {
                node.warn("Input payload is not a number, ignoring.");
                return done();
            }

            // --- Handle Dynamic Threshold Update ---
            if (thresholdType === 'dynamic' && msg.topic === topicThreshold) {
                if (!deltasValid) {
                    node.warn("Cannot update dynamic thresholds: Invalid deltas configured.");
                } else {
                    const centerValue = payload;
                    const newRising = centerValue + deltaR;
                    const newFalling = centerValue - deltaF;
                    if (newRising > newFalling) {
                        dynamicRising = newRising;
                        dynamicFalling = newFalling;
                        dynamicThresholdsValid = true;
                        node.log(`Dynamic thresholds updated: R=${dynamicRising}, F=${dynamicFalling}`);
                        setStatusSafely({ fill: 'yellow', shape: 'ring', text: `${dynamicFalling}/--/${dynamicRising}` });
                    } else {
                        dynamicThresholdsValid = false;
                        dynamicRising = NaN; dynamicFalling = NaN;
                        setStatusSafely({ fill: 'red', shape: 'dot', text: 'invalid calculated thresholds' });
                        node.warn(`Dynamic calc invalid: Upper (${newRising}) !> Lower (${newFalling}).`);
                    }
                }
                return done();
            }

            // --- Evaluate Thresholds (Fixed or Dynamic) ---
            let currentRising = NaN;
            let currentFalling = NaN;
            let currentThresholdsValid = false;

            const evaluateAndProcess = (risingVal, fallingVal) => {
                currentRising = parseFloat(risingVal);
                currentFalling = parseFloat(fallingVal);

                if (!Number.isNaN(currentRising) && !Number.isNaN(currentFalling) && currentRising > currentFalling) {
                    currentThresholdsValid = true;
                } else {
                    currentThresholdsValid = false;
                    node.warn(`Threshold logic error: R='${risingVal}', F='${fallingVal}'`);
                }
                processHysteresisLogic(msg, payload, send, done);
            };

            if (thresholdType === 'fixed') {
                RED.util.evaluateNodeProperty(thresholdRisingValue, thresholdRisingType, node, msg, (errR, valR) => {
                    if (errR) {
                        node.error(`Error evaluating Upper Threshold: ${errR.message}`, msg);
                        return processHysteresisLogic(msg, payload, send, done);
                    }
                    RED.util.evaluateNodeProperty(thresholdFallingValue, thresholdFallingType, node, msg, (errF, valF) => {
                        if (errF) {
                            node.error(`Error evaluating Lower Threshold: ${errF.message}`, msg);
                            return processHysteresisLogic(msg, payload, send, done);
                        }
                        evaluateAndProcess(valR, valF);
                    });
                });
            } else if (thresholdType === 'dynamic') {
                if (msg.topic === topicCurrent) {
                    if (dynamicThresholdsValid) {
                        evaluateAndProcess(dynamicRising, dynamicFalling);
                    } else if (dynRaiseError) {
                        const err = new Error(`Hysteresis check failed: Dynamic thresholds not established or invalid.`);
                        setStatusSafely({ fill: 'red', shape: 'ring', text: 'Error: Thresholds missing' });
                        return done ? done(err) : node.error(err, msg);
                    } else {
                        node.warn(`Ignoring input value on topic '${topicCurrent}': Dynamic thresholds not established or invalid.`);
                        return done();
                    }
                } else {
                    return done();
                }
            } else {
                return done();
            }

            // --- Core Hysteresis Logic ---
            function processHysteresisLogic(_msg, _payload, _send, _done) {
                if (!currentThresholdsValid) {
                    setStatusSafely({ fill: 'red', shape: 'ring', text: 'Error: Invalid Thresholds' });
                    return _done();
                }

                const prevDirection = node.direction;
                const prevValue = node.lastValue;
                const isInitial = prevDirection === null;
                let newDirection = null;
                let outputConfig = null;
                let status = null;
                let tag = '';

                if (isInitial) {
                    if (_payload >= currentRising) {
                        newDirection = 'high';
                        outputConfig = { type: outRisingType, value: outRisingValue };
                        status = { fill: 'green', shape: 'dot', text: `${currentFalling}/${_payload}/${currentRising} (initial high band)` };
                        tag = 'initial high';
                    } else if (_payload <= currentFalling) {
                        newDirection = 'low';
                        outputConfig = { type: outFallingType, value: outFallingValue };
                        status = { fill: 'blue', shape: 'dot', text: `${currentFalling}/${_payload}/${currentRising} (initial low band)` };
                        tag = 'initial low';
                    } else {
                        newDirection = 'deadband';
                        status = { fill: 'yellow', shape: 'ring', text: `${currentFalling}/${_payload}/${currentRising} (Initial Deadband)` };
                    }
                } else {
                    if ((prevDirection === 'low' || prevDirection === 'deadband') && _payload >= currentRising) {
                        newDirection = 'high';
                        outputConfig = { type: outRisingType, value: outRisingValue };
                        status = { fill: 'green', shape: 'dot', text: `${currentFalling}/${_payload}/${currentRising} (high band)` };
                        tag = 'rising';
                    } else if ((prevDirection === 'high' || prevDirection === 'deadband') && _payload <= currentFalling) {
                        newDirection = 'low';
                        outputConfig = { type: outFallingType, value: outFallingValue };
                        status = { fill: 'blue', shape: 'dot', text: `${currentFalling}/${_payload}/${currentRising} (low band)` };
                        tag = 'falling';
                    } else {
                        const move = typeof prevValue === 'number' ? (_payload > prevValue ? 'rising' : (_payload < prevValue ? 'falling' : 'steady')) : 'unknown';
                        const dir = prevDirection;
                        const fill = dir === 'high' ? 'green' : 'blue';
                        const shape = (_payload >= currentRising || _payload <= currentFalling) ? 'dot' : 'ring';
                        const text = `${currentFalling}/${_payload}/${currentRising} (${dir} ${shape === 'dot' ? 'band' : 'dead band'} ${move})`;
                        setStatusSafely({ fill, shape, text });
                        node.lastValue = _payload;
                        nodeContext.set('LastValue', _payload);
                        return _done();
                    }
                }

                const shouldSend = newDirection !== 'deadband' && (isInitial ? initialMessageFlag : true);

                if (shouldSend && outputConfig) {
                    const msgOut = RED.util.cloneMessage(_msg);
                    msgOut.hystdirection = tag;

                    RED.util.evaluateNodeProperty(outTopicValue, outTopicType, node, _msg, (errT, valT) => {
                        if (errT) {
                            node.error(`Error evaluating Output Topic: ${errT.message}`, _msg);
                            finalize();
                            return;
                        }
                        msgOut.topic = valT;

                        if (outputConfig.type === 'pay' || outputConfig.type === 'msg') {
                            msgOut.payload = _payload;
                            _send(msgOut);
                            finalize();
                        } else {
                            RED.util.evaluateNodeProperty(outputConfig.value, outputConfig.type, node, _msg, (errP, valP) => {
                                if (errP) {
                                    node.error(`Error evaluating Output Payload: ${errP.message}`, _msg);
                                } else {
                                    msgOut.payload = valP;
                                    _send(msgOut);
                                }
                                finalize();
                            });
                        }
                    });
                } else {
                    finalize();
                }

                function finalize() {
                    if (newDirection !== null && newDirection !== prevDirection) {
                        node.direction = newDirection;
                        nodeContext.set('Direction', newDirection);
                    }
                    node.lastValue = _payload;
                    nodeContext.set('LastValue', _payload);
                    setStatusSafely(status);
                    _done();
                }
            }
        });

        node.on('close', function (removed, done) {
            node.log("Hysteresis node stopped.");
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('hysteresis', HysteresisNode);
};
