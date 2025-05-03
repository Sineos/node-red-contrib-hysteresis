# node-red-contrib-hysteresis

[![npm version](https://badge.fury.io/js/node-red-contrib-hysteresis.svg)](https://badge.fury.io/js/node-red-contrib-hysteresis)

A Node-RED node that provides a hysteresis (deadband) function, preventing rapid output changes based on fluctuating input values.

## Key Features

* **Hysteresis Logic:** Only outputs a message when the input value crosses a threshold *and* changes the node's state (e.g., from Low to High).
* **Fixed or Dynamic Thresholds:** Configure static thresholds or set them dynamically via input messages.
* **State Persistence:** Remembers its last state (High/Low/Deadband) and the last input value across deploys (if context storage is enabled). Dynamic thresholds are *not* persisted.
* **Initial State Handling:** Correctly determines the initial state (High, Low, or Deadband) based on the first input after deployment, regardless of the "Send Output on Initial State" setting.
* **Detailed Status Updates:** Provides granular visual status feedback about the current state, thresholds, input value, and direction of change.
* **Configurable Output:** Control the payload and topic of the output message.

## Installation

Install via Node Red's Pallet or run the following command in your Node-RED user directory (typically `~/.node-red`):

```bash
npm install node-red-contrib-hysteresis
```

## Inputs

* **`msg.payload`** (*number*): The numeric input value to be checked against the thresholds. Non-numeric payloads are ignored.
* **`msg.topic`** (*string, optional*):
  * In **Dynamic Mode**, the topic distinguishes messages:
    * Messages with the configured `Threshold Topic` set the center point (using `msg.payload`).
    * Messages with the configured `Input Value Topic` provide the value to check (using `msg.payload`).
  * In **Fixed Mode**, the topic is usually ignored by the node but passed through if the output topic is set to 'Original Topic'.

## Outputs

An output message is sent *only* when a threshold crossing causes a state change (Low -> High, High -> Low, Deadband -> High, Deadband -> Low).

1. **Primary Output:**
  * **`msg.payload`**: The configured output payload for the specific transition (Rising or Falling). Can be the original input payload or a fixed String, Number, Boolean, or JSON value.
  * **`msg.topic`** (*string*): The configured output topic. Can be the original input topic or a fixed String value.
  * **`msg.hystdirection`** (*string*): Indicates the reason for the output message:
    * `"initial high"` / `"initial low"`: Sent for the *first* input value if it crosses a threshold *and* "Send Output on Initial State" is enabled.
    * `"rising"`: State changed from Low or Deadband to High.
    * `"falling"`: State changed from High or Deadband to Low.

## Node Configuration

### Threshold Settings

* **Mode**: Choose between `Fixed Thresholds` or `Dynamic Thresholds (via msg)`.

#### Fixed Thresholds Mode

* **Upper Threshold**: The static numeric value the input must meet or exceed to trigger a 'high' state (when coming from 'low' or 'deadband').
* **Lower Threshold**: The static numeric value the input must meet or fall below to trigger a 'low' state (when coming from 'high' or 'deadband').
  * *Constraint:* The Upper Threshold must be strictly greater than the Lower Threshold.

#### Dynamic Thresholds Mode

Thresholds are calculated based on runtime messages.

* **Threshold Topic**: *Required topic* for messages whose `msg.payload` (number) sets the center point for calculations.
* **Input Value Topic**: *Required topic* for messages whose `msg.payload` (number) is the value to check against the calculated thresholds.
* **Hysteresis (+)**: A non-negative number added to the center point to calculate the dynamic Upper Threshold.
* **Hysteresis (-)**: A non-negative number subtracted from the center point to calculate the dynamic Lower Threshold.
* **Error if Threshold Missing**: If checked, an error is raised if a value arrives on the `Input Value Topic` before valid dynamic thresholds have been set via the `Threshold Topic`. Otherwise, a warning is logged, and the message is ignored.
* **Note on Persistence**: Dynamic thresholds (Upper and Lower) calculated from incoming messages are **not saved** across Node-RED deploys or restarts. The node will start without valid dynamic thresholds and require a new message on the `Threshold Topic`.

### Output Settings

* **Send Output on Initial State**:
  * If checked: Sends an output message if the *very first* valid input after deployment is already above the Upper or below the Lower threshold.
  * If unchecked: Sends no output for the first input, even if it's outside the deadband.
  * *Note:* The node's internal state (High, Low, or Deadband) is *always* determined and tracked based on the first input, regardless of this setting.
* **Output Payload (Rising/Falling)**: Configure the `msg.payload` for messages sent when transitioning to the High state (Rising) or Low state (Falling). Options: 'Original Payload', String, Number, Boolean, JSON.
* **Output Topic**: Configure the `msg.topic` for output messages. Options: 'Original Topic' or a fixed String value.

## Node Status

The node provides detailed visual status updates, useful for monitoring and debugging. Examples include:

* `Error: Invalid Fixed Thresholds`
* `waiting for threshold topic`
* `waiting for input`
* `R:22 F:18 Val:20 (Initial Deadband)`
* `R:22 F:18 Val:23 (initial high band)` (*Only if output sent*)
* `R:22 F:18 Val:17 (initial low band)` (*Only if output sent*)
* `R:22 F:18 Val:25 (high band rising)` (*Value increasing, still high*)
* `R:22 F:18 Val:15 (low band falling)` (*Value decreasing, still low*)
* `R:22 F:18 Val:20 (high dead band falling)` (*Value fell into deadband from high*)
* `R:22 F:18 Val:19 (low dead band rising)` (*Value rose into deadband from low*)
* `R:22 F:18 Val:24 (high band)` (*Output sent for Low->High transition*)
* `R:22 F:18 Val:16 (low band)` (*Output sent for High->Low transition*)

You can use the standard Node-RED `Status` node to monitor this node and trigger flows based on specific status text (e.g., reacting to the `(Initial Deadband)` state).

## Use Cases

* **Thermostat Control:** Turn heating on below 18°C, off above 22°C.
* **Tank Level / Pump Control:** Start pump below 20%, stop above 80%.
* **Signal Debouncing / Filtering:** Ignore minor sensor noise around a threshold. Only react to significant changes.