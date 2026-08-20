import { createIncidentManager } from './incidentManager.js';
import * as store from '../store/incidentStore.js';

export const incidentManager = createIncidentManager({ store });
