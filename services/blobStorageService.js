const path = require('path');
const { randomUUID } = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const ATTACHMENT_ROOT = 'email-template-attachments';

let blobServiceClient;
let containerClient;

const readEnvValue = (name) => {
  const value = process.env[name];
  if (!value) return '';
  return value.trim().replace(/^['"]|['"]$/g, '');
};

const createConfigError = (message) => {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
};

const buildConnectionStringFromAccountKey = () => {
  const accountName = readEnvValue('AZURE_STORAGE_ACCOUNT_NAME');
  const accountKey = readEnvValue('AZURE_STORAGE_ACCOUNT_KEY');

  if (!accountName || !accountKey) return '';

  return [
    'DefaultEndpointsProtocol=https',
    `AccountName=${accountName}`,
    `AccountKey=${accountKey}`,
    'EndpointSuffix=core.windows.net'
  ].join(';');
};

const getStorageConnectionString = () => {
  const connectionString = readEnvValue('AZURE_STORAGE_CONNECTION_STRING');

  if (!connectionString) {
    const fallbackConnectionString = buildConnectionStringFromAccountKey();
    if (fallbackConnectionString) return fallbackConnectionString;

    throw createConfigError(
      'Azure Blob storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING to the full Azure storage connection string, or set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY.'
    );
  }

  const hasAccountName = connectionString.includes('AccountName=');
  const hasAccountKey = connectionString.includes('AccountKey=');
  const hasBlobEndpoint = connectionString.includes('BlobEndpoint=');
  const hasSharedAccessSignature = connectionString.includes('SharedAccessSignature=');
  const isDevelopmentStorage = connectionString.includes('UseDevelopmentStorage=true');

  if (isDevelopmentStorage || (hasAccountName && hasAccountKey) || (hasBlobEndpoint && hasSharedAccessSignature)) {
    return connectionString;
  }

  const fallbackConnectionString = buildConnectionStringFromAccountKey();
  if (fallbackConnectionString) return fallbackConnectionString;

  throw createConfigError(
    'AZURE_STORAGE_CONNECTION_STRING is not a full Azure storage connection string. Paste the full "Connection string" value from Azure Storage access keys, not only the key value.'
  );
};

const getContainerClient = () => {
  if (!containerClient) {
    const connectionString = getStorageConnectionString();
    const containerName = readEnvValue('AZURE_EMAIL_ATTACHMENTS_CONTAINER');

    if (!containerName) {
      throw createConfigError('AZURE_EMAIL_ATTACHMENTS_CONTAINER is not set');
    }

    try {
      blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    } catch (error) {
      throw createConfigError(`Invalid Azure Blob storage connection string: ${error.message}`);
    }

    containerClient = blobServiceClient.getContainerClient(containerName);
  }

  return containerClient;
};

const sanitizeFileName = (fileName = 'attachment') => {
  const parsed = path.parse(fileName);
  const baseName = parsed.name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'attachment';
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 20);

  return `${baseName}${ext}`;
};

const getUserAttachmentPrefix = (userId) => `${ATTACHMENT_ROOT}/${userId}/`;

const buildAttachmentBlobName = (userId, originalName) => {
  const safeName = sanitizeFileName(originalName);
  return `${getUserAttachmentPrefix(userId)}${randomUUID()}-${safeName}`;
};

const assertUserOwnsAttachmentBlob = (userId, blobName) => {
  if (!blobName || !blobName.startsWith(getUserAttachmentPrefix(userId))) {
    const error = new Error('Attachment does not belong to this user');
    error.statusCode = 403;
    throw error;
  }
};

const uploadAttachmentBuffer = async ({ userId, file }) => {
  const client = getContainerClient();
  await client.createIfNotExists();

  const blobName = buildAttachmentBlobName(userId, file.originalname);
  const blockBlobClient = client.getBlockBlobClient(blobName);
  const fileName = sanitizeFileName(file.originalname);

  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: {
      blobContentType: file.mimetype || 'application/octet-stream',
      blobContentDisposition: `attachment; filename="${fileName}"`
    },
    metadata: {
      userId: String(userId),
      originalName: fileName
    }
  });

  return {
    originalName: file.originalname,
    fileName,
    blobName,
    contentType: file.mimetype || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date()
  };
};

const deleteAttachmentBlob = async ({ userId, blobName }) => {
  assertUserOwnsAttachmentBlob(userId, blobName);
  const client = getContainerClient();
  const blockBlobClient = client.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
};

const streamToBuffer = async (readableStream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
    readableStream.on('end', () => resolve(Buffer.concat(chunks)));
    readableStream.on('error', reject);
  });
};

const downloadAttachmentBuffer = async (blobName) => {
  const client = getContainerClient();
  const blockBlobClient = client.getBlockBlobClient(blobName);
  const response = await blockBlobClient.download(0);
  return streamToBuffer(response.readableStreamBody);
};

module.exports = {
  assertUserOwnsAttachmentBlob,
  deleteAttachmentBlob,
  downloadAttachmentBuffer,
  uploadAttachmentBuffer
};
