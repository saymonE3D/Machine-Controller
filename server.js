const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect('mongodb+srv://saymon_db_user:sS3hv6KsQL3mZOUr@cluster0.2v6cd3c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Machine Schema with unique constraint on name
const machineSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  nodeId: String,
  startUrl: String,
  stopUrl: String,
  status: String,
  os: String,
  ip: String,
  lastbootuptime: String,
  createdAt: { type: Date, default: Date.now }
});

const Machine = mongoose.model('Machine', machineSchema);

// Function to clean up old indexes
async function cleanupIndexes() {
  try {
    const indexes = await Machine.collection.getIndexes();
    console.log('Current indexes:', Object.keys(indexes));
    
    // Drop the problematic index if it exists
    if (indexes['pi_1_gpio_1']) {
      await Machine.collection.dropIndex('pi_1_gpio_1');
      console.log('Dropped old pi_1_gpio_1 index');
    }
  } catch (error) {
    console.log('Index cleanup error (this is usually fine):', error.message);
  }
}

// Clean up indexes on startup
cleanupIndexes();

// Routes

// Get all machines from API and save to database
app.get('/api/refresh-machines', async (req, res) => {
  try {
    const response = await axios.get('https://rpi1.eagle3dstreaming.com/api/nodes');
    const nodes = response.data.nodes;
    
    // Update database with current status
    for (const [name, nodeData] of Object.entries(nodes)) {
      await Machine.findOneAndUpdate(
        { name: name },
        {
          nodeId: nodeData.id,
          status: nodeData.status,
          os: nodeData.os,
          ip: nodeData.ip,
          lastbootuptime: nodeData.lastbootuptime
        },
        { upsert: false }
      );
    }
    
    const machines = await Machine.find();
    res.json({ success: true, machines, nodes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all machines
app.get('/api/machines', async (req, res) => {
  try {
    const machines = await Machine.find();
    res.json(machines);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new machine
app.post('/api/machines', async (req, res) => {
  try {
    const { name, startUrl, stopUrl } = req.body;
    
    // Check if machine with this name already exists
    const existingMachine = await Machine.findOne({ name: name });
    if (existingMachine) {
      return res.status(400).json({ error: 'Machine with this name already exists' });
    }
    
    // Get current status from API
    const response = await axios.get('https://rpi1.eagle3dstreaming.com/api/nodes');
    const nodeData = response.data.nodes[name];
    
    const machine = new Machine({
      name,
      startUrl,
      stopUrl,
      nodeId: nodeData?.id || '',
      status: nodeData?.status || 'unknown',
      os: nodeData?.os || '',
      ip: nodeData?.ip || '',
      lastbootuptime: nodeData?.lastbootuptime || ''
    });
    
    await machine.save();
    res.json({ success: true, machine });
  } catch (error) {
    console.log('Error adding machine:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update machine
app.put('/api/machines/:id', async (req, res) => {
  try {
    const { startUrl, stopUrl } = req.body;
    const machine = await Machine.findByIdAndUpdate(
      req.params.id,
      { startUrl, stopUrl },
      { new: true }
    );
    res.json({ success: true, machine });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete machine
app.delete('/api/machines/:id', async (req, res) => {
  try {
    await Machine.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start machine
app.post('/api/machines/:id/start', async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    
    await axios.get(machine.startUrl);
    
    // Refresh status after operation (wait 20 seconds for machine to respond)
    setTimeout(async () => {
      try {
        const response = await axios.get('https://rpi1.eagle3dstreaming.com/api/nodes');
        const nodeData = response.data.nodes[machine.name];
        if (nodeData) {
          machine.status = nodeData.status;
          await machine.save();
          console.log(`Machine ${machine.name} status updated to: ${nodeData.status}`);
        }
      } catch (error) {
        console.log('Error refreshing status after start:', error);
      }
    }, 30000);
    
    res.json({ success: true, message: 'Start command sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop machine
app.post('/api/machines/:id/stop', async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: 'Machine not found' });
    }
    
    await axios.get(machine.stopUrl);
    
    // Refresh status after operation (wait 20 seconds for machine to respond)
    setTimeout(async () => {
      try {
        const response = await axios.get('https://rpi1.eagle3dstreaming.com/api/nodes');
        const nodeData = response.data.nodes[machine.name];
        if (nodeData) {
          machine.status = nodeData.status;
          await machine.save();
          console.log(`Machine ${machine.name} status updated to: ${nodeData.status}`);
        }
      } catch (error) {
        console.log('Error refreshing status after stop:', error);
      }
    }, 30000);
    
    res.json({ success: true, message: 'Stop command sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available nodes for dropdown
app.get('/api/nodes', async (req, res) => {
  try {
    const response = await axios.get('https://rpi1.eagle3dstreaming.com/api/nodes');
    const nodes = Object.keys(response.data.nodes);
    res.json(nodes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});