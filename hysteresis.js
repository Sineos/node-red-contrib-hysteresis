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
      if ((this.OutRisingType === 'num') && (!isNaN(this.OutRisingValue))) {
        this.OutRisingValue = parseFloat(this.OutRisingValue);
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
      if ((this.OutFallingType === 'num') && (!isNaN(this.OutFallingValue))) {
        this.OutFallingValue = parseFloat(this.OutFallingValue);
      } else if (this.OutFallingType === 'bool' && (this.OutFallingValue === 'true' || this.OutFallingValue === 'false')) {
        (this.OutFallingValue === 'true' ? this.OutFallingValue = true : this.OutFallingValue = false);
      } else if (this.OutFallingValue === 'null') {
        this.OutFallingType = 'null';
        this.OutFallingValue = null;
      } else {
        this.OutFallingValue = String(this.OutFallingValue);
      }
    }

    var node = this;
    var TriggerValueRising = '';
    var TriggerValueFalling = '';
    if (this.ThresholdType === 'fixed') {
      TriggerValueRising = parseFloat(this.ThresholdRising);
      TriggerValueFalling = parseFloat(this.ThresholdFalling);
    }
    // clear direction flag
    node.direction = '';

    this.on('input', function(msg) {
      // Check for proper topic when using dynamic threshold
      if (this.ThresholdType === 'dynamic' && msg.topic === this.TopicThreshold && !isNaN(msg.payload)) {
        TriggerValueRising = parseFloat(msg.payload) + parseFloat(this.ThresholdDeltaRising);
        TriggerValueFalling = parseFloat(msg.payload) - parseFloat(this.ThresholdDeltaFalling);
      }

      // original msg object
      var msgNew = RED.util.cloneMessage(msg);
      // set topic
      if (this.OutTopicType === 'str') {
        msgNew.topic = this.OutTopicValue;
      }

      if ((msg.hasOwnProperty('payload') && this.ThresholdType === 'fixed' && !isNaN(msg.payload)) ||
          (msg.hasOwnProperty('payload') && this.ThresholdType === 'dynamic' &&
          msg.topic === this.TopicCurrent && TriggerValueRising && !isNaN(msg.payload))) {
        var CurrentValue = parseFloat(msg.payload);
        // Cover the case where no initial values are known
        if (this.InitialMessage && node.direction === '' && !isNaN(CurrentValue)) {
          if (CurrentValue >= TriggerValueRising) {
            msgNew.payload = (this.OutRisingType === 'pay' ? msgNew.payload : this.OutRisingValue);
            msgNew.hystdirection = 'initial high';
            node.send(msgNew);
            node.direction = 'high';
          } else if (CurrentValue <= TriggerValueFalling) {
            msgNew.payload = (this.OutFallingType === 'pay' ? msgNew.payload : this.OutFallingValue);
            msgNew.hystdirection = 'initial low';
            node.send(msgNew);
            node.direction = 'low';
          }
        // Last value known. Work as hysteresis
        } else if (!isNaN(CurrentValue) && node.LastValue) {
          // rising
          if (CurrentValue > node.LastValue && CurrentValue >= TriggerValueRising && node.direction !== 'high') {
            msgNew.payload = (this.OutRisingType === 'pay' ? msgNew.payload : this.OutRisingValue);
            msgNew.hystdirection = 'high';
            node.send(msgNew);
            node.direction = 'high';
          // falling
          } else if (CurrentValue < node.LastValue && CurrentValue <= TriggerValueFalling && node.direction !== 'low') {
            msgNew.payload = (this.OutFallingType === 'pay' ? msgNew.payload : this.OutFallingValue);
            msgNew.hystdirection = 'low';
            node.send(msgNew);
            node.direction = 'low';
          }
        }
        node.LastValue = CurrentValue;
      }
    });
  }
  RED.nodes.registerType('hysteresis', HysteresisNode);
};
