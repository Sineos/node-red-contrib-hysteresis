module.exports = function(RED) {
	'use strict';
	function HysteresisNode(config) {
		RED.nodes.createNode(this, config);

		this.ThresholdType = config.ThresholdType || 'fixed';
		this.ThresholdRising = config.ThresholdRising;
		this.ThresholdFalling = config.ThresholdFalling;
		this.TopicThreshold = config.TopicThreshold;
		this.TopicCurrent = config.TopicCurrent;
		this.ThresholdDeltaRising = config.ThresholdDeltaRising;
		this.ThresholdDeltaFalling = config.ThresholdDeltaFalling;
		this.InitialMessage = config.InitialMessage;
		this.OutRisingType = config.OutRisingType;
		this.OutRisingValue = config.OutRisingValue;
		this.OutFallingType = config.OutFallingType;
		this.OutFallingValue = config.OutFallingValue;
		this.OutTopicType = config.OutTopicType;
		this.OutTopicValue = config.OutTopicValue || '';

		if (this.OutRisingType !== 'pay') {
			if ((this.OutRisingType === 'num') && (!Number.isNaN(this.OutRisingValue))) {
				this.OutRisingValue = Number.parseFloat(this.OutRisingValue);
			} else if (this.OutRisingType === 'bool' && (this.OutRisingValue === 'true' || this.OutRisingValue === 'false')) {
				(this.OutRisingValue === 'true' ? this.OutRisingValue = true : this.OutRisingValue = false);
			} else if (this.OutRisingValue === 'null') {
				this.OutRisingType = 'null';
				this.OutRisingValue = null;
			} else {
				this.OutRisingValue = String(this.OutRisingValue);
			}
		}

		if (this.OutFallingType !== 'pay') {
			if ((this.OutFallingType === 'num') && (!Number.isNaN(this.OutFallingValue))) {
				this.OutFallingValue = Number.parseFloat(this.OutFallingValue);
			} else if (this.OutFallingType === 'bool' && (this.OutFallingValue === 'true' || this.OutFallingValue === 'false')) {
				(this.OutFallingValue === 'true' ? this.OutFallingValue = true : this.OutFallingValue = false);
			} else if (this.OutFallingValue === 'null') {
				this.OutFallingType = 'null';
				this.OutFallingValue = null;
			} else {
				this.OutFallingValue = String(this.OutFallingValue);
			}
		}

		// eslint-disable-next-line prefer-const
		let node = this;
		let TriggerValueRising = '';
		let TriggerValueFalling = '';
		if (this.ThresholdType === 'fixed') {
			TriggerValueRising = Number.parseFloat(this.ThresholdRising);
			TriggerValueFalling = Number.parseFloat(this.ThresholdFalling);
		}
		// clear direction flag
		node.direction = '';

		// Set initial status
		if (!TriggerValueRising) {
			node.status({fill:'red', shape:'ring', text: 'Thresholds missing'});
		} else {
			node.status({fill:'yellow', shape:'ring', text: TriggerValueFalling + '/--/' + TriggerValueRising});
		}

		this.on('input', function(msg) {
			// Check for proper topic when using dynamic threshold
			if (this.ThresholdType === 'dynamic' && msg.topic === this.TopicThreshold && !Number.isNaN(msg.payload)) {
				TriggerValueRising = Number.parseFloat(msg.payload) + Number.parseFloat(this.ThresholdDeltaRising);
				TriggerValueFalling = Number.parseFloat(msg.payload) - Number.parseFloat(this.ThresholdDeltaFalling);
				node.status({fill:'yellow', shape:'ring', text: TriggerValueFalling + '/--/' + TriggerValueRising});
			}

			// original msg object
			const msgNew = RED.util.cloneMessage(msg);
			// set topic
			if (this.OutTopicType === 'str') {
				msgNew.topic = this.OutTopicValue;
			}

			if ((Object.prototype.hasOwnProperty.call(msg, 'payload') && this.ThresholdType === 'fixed' && !Number.isNaN(msg.payload)) ||
          (Object.prototype.hasOwnProperty.call(msg, 'payload') && this.ThresholdType === 'dynamic' &&
          msg.topic === this.TopicCurrent && TriggerValueRising && !Number.isNaN(msg.payload))) {
				const CurrentValue = Number.parseFloat(msg.payload);
				// Cover the case where no initial values are known
				if (this.InitialMessage && node.direction === '' && !Number.isNaN(CurrentValue)) {
					if (CurrentValue >= TriggerValueRising) {
						msgNew.payload = (this.OutRisingType === 'pay' ? msgNew.payload : this.OutRisingValue);
						msgNew.hystdirection = 'initial high';
						node.send(msgNew);
						node.direction = 'high';
						node.status({fill:'green', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (initial high band)'});
					} else if (CurrentValue <= TriggerValueFalling) {
						msgNew.payload = (this.OutFallingType === 'pay' ? msgNew.payload : this.OutFallingValue);
						msgNew.hystdirection = 'initial low';
						node.send(msgNew);
						node.direction = 'low';
						node.status({fill:'blue', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (initial low band)'});
					}
					// Last value known. Work as hysteresis
				} else if (!Number.isNaN(CurrentValue) && node.LastValue) {
					// rising
					if (CurrentValue > node.LastValue && CurrentValue >= TriggerValueRising && node.direction !== 'high') {
						msgNew.payload = (this.OutRisingType === 'pay' ? msgNew.payload : this.OutRisingValue);
						msgNew.hystdirection = 'high';
						node.send(msgNew);
						node.direction = 'high';
						node.status({fill:'green', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (high band)'});
						// falling
					} else if (CurrentValue < node.LastValue && CurrentValue <= TriggerValueFalling && node.direction !== 'low') {
						msgNew.payload = (this.OutFallingType === 'pay' ? msgNew.payload : this.OutFallingValue);
						msgNew.hystdirection = 'low';
						node.send(msgNew);
						node.direction = 'low';
						node.status({fill:'blue', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (low band)'});
					} else if (CurrentValue > node.LastValue && CurrentValue >= TriggerValueRising && node.direction === 'high') {
						node.status({fill:'green', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (high band rising)'});
					} else if (CurrentValue < node.LastValue && CurrentValue >= TriggerValueRising && node.direction === 'high') {
						node.status({fill:'green', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (high band falling)'});
					} else if (CurrentValue > node.LastValue && CurrentValue > TriggerValueFalling && CurrentValue < TriggerValueRising && node.direction === 'high') {
						node.status({fill:'green', shape:'ring', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (high dead band rising)'});
					} else if (CurrentValue < node.LastValue && CurrentValue > TriggerValueFalling && CurrentValue < TriggerValueRising && node.direction === 'high') {
						node.status({fill:'green', shape:'ring', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (high dead band falling)'});
					} else if (CurrentValue > node.LastValue && CurrentValue > TriggerValueFalling && CurrentValue < TriggerValueRising && node.direction === 'low') {
						node.status({fill:'blue', shape:'ring', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (low dead band rising)'});
					} else if (CurrentValue < node.LastValue && CurrentValue > TriggerValueFalling && CurrentValue < TriggerValueRising && node.direction === 'low') {
						node.status({fill:'blue', shape:'ring', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (low dead band falling)'});
					} else if (CurrentValue > node.LastValue && CurrentValue <= TriggerValueFalling && node.direction === 'low') {
						node.status({fill:'blue', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueRising + ' (low band rising)'});
					} else if (CurrentValue < node.LastValue && CurrentValue <= TriggerValueFalling && node.direction === 'low') {
						node.status({fill:'blue', shape:'dot', text: TriggerValueFalling + '/' + CurrentValue + '/' + TriggerValueFalling + ' (low band falling)'});
					}
				}
				node.LastValue = CurrentValue;
			}
		});
	}
	RED.nodes.registerType('hysteresis', HysteresisNode);
};
