import fs from 'fs-extra'
import mime from 'mime'
import ms from 'ms'
import escape from 'escape-string-regexp'

import { getObjects } from './media'
import cloudFront from 'infrastructure/cloud-front'
import config from 'infrastructure/config'
import s3 from 'infrastructure/s3'
import localpath from 'services/localpath'
import { searchAllObjects } from 'services/elastic-search'
const { version = '0.0.1' } = config

export const cloudPath = (key) => `${ version }/${ key }`

export default {
  async head(key, etag) {
    return await s3.headObject({
      Bucket: s3.config.bucket,
      Key: cloudPath(key),
      IfMatch: etag
    }).promise()
  },
  async put(key, file, options = {}) {
    const { meta, ttl } = options

    return await s3.upload({
      Bucket: s3.config.bucket,
      Key: cloudPath(key),
      ContentType: file.contentType || 'application/octet-stream',
      Body: fs.createReadStream(file.path),
      Expires: ttl ? new Date(Date.now() + ms(ttl)) : undefined,
      Metadata: meta || {}
    }).promise()
  },
  async get(key, etag) {
    const downloadPath = await localpath()
    const res = {}

    const data = await s3.getObject({
      Bucket: s3.config.bucket,
      Key: cloudPath(key),
      IfMatch: etag
    }).promise()

    res.contentType = data.ContentType
    res.ext = mime.getExtension(res.contentType)
    res.path = `${ downloadPath }.${ res.ext }`

    await fs.outputFile(res.path, data.Body)

    return res
  },
  async invalid({ patterns = [], distributionId }) {
    const date = new Date()
    const reference = String(date.getTime())
    const params = {
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: reference,
        Paths: {
          Quantity: patterns.length,
          Items: patterns
        }
      }
    }

    return await cloudFront.createInvalidation(params).promise()
  },
  async search({ identifier, patterns }) {
    const originObjects = await patterns.reduce(
      async (previousJob, pattern) => {
        const previObjects = await previousJob || []
        const nextObjects = await searchAllObjects({
          identifier,
          params: {
            regexp: {
              originUrl: `${ escape(`${ pattern }`) }.*`
            }
          }
        })
        return nextObjects.concat(previObjects)
      },Promise.resolve()
    )

    const allObjects = await originObjects.reduce(
      async (previousJob, { key: _key }) => {
        const previObjects = await previousJob || []
        const nextObjects = await searchAllObjects({
          identifier,
          params: {
            regexp: {
              key: `${ escape(`${ _key }`) }.*`
            }
          }
        })
        return nextObjects.concat(previObjects)
      },Promise.resolve()
    )
    return allKeys
  },
  async delete(keys) {
    try {
      await s3.deleteObjects({
        Bucket: s3.config.bucket,
        Delete: {
          Objects: keys.map(({ key }) => ({ Key: key }))
        }
      }).promise()
    } catch (e) {
      console.error(e)
    }
  },
  stream(key, etag) {
    return s3.getObject({
      Bucket: s3.config.bucket,
      Key: cloudPath(key),
      IfMatch: etag
    }).createReadStream()
  }
}
