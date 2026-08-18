import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { createClient as createRedisClient } from 'redis';
import { MongoClient } from 'mongodb';

if (typeof PgClient !== 'function') throw new Error('PostgreSQL client import failed.');
if (typeof mysql.createConnection !== 'function') throw new Error('MySQL client import failed.');
if (typeof createRedisClient !== 'function') throw new Error('Redis client import failed.');
if (typeof MongoClient !== 'function') throw new Error('MongoDB client import failed.');
console.log('driver imports and factories: PASS');
