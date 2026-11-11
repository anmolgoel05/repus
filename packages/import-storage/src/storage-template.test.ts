import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const template=JSON.parse(readFileSync(resolve(__dirname,'../../../infrastructure/aws/private-storage.json'),'utf8'));
const resources=template.Resources;
describe('private application storage deployment',()=>{
 it('blocks public access, disables ACLs, encrypts objects and requires TLS',()=>{
  const bucket=resources.PrivateObjects.Properties;
  expect(bucket.PublicAccessBlockConfiguration).toEqual({BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true});
  expect(bucket.OwnershipControls.Rules).toEqual([{ObjectOwnership:'BucketOwnerEnforced'}]);
  expect(bucket.BucketEncryption.ServerSideEncryptionConfiguration).toEqual([{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]);
  expect(resources.PrivateObjectsPolicy.Properties.PolicyDocument.Statement).toEqual([{
   Sid:'DenyInsecureTransport',Effect:'Deny',Principal:'*',Action:'s3:*',
   Resource:[{'Fn::GetAtt':['PrivateObjects','Arn']},{'Fn::Sub':'${PrivateObjects.Arn}/*'}],
   Condition:{Bool:{'aws:SecureTransport':'false'}},
  }]);
 });
 it('retains completed images and cleans only abandoned multipart uploads',()=>{
  expect(resources.PrivateObjects.DeletionPolicy).toBe('Retain');
  expect(resources.PrivateObjects.UpdateReplacePolicy).toBe('Retain');
  expect(resources.PrivateObjectsPolicy.DeletionPolicy).toBe('Retain');
  expect(resources.PrivateObjectsPolicy.UpdateReplacePolicy).toBe('Retain');
  expect(resources.PrivateObjects.Properties.LifecycleConfiguration.Rules).toEqual([{Id:'AbortAbandonedMultipartUploads',Status:'Enabled',AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}}]);
  expect(resources.PrivateObjects.Properties.VersioningConfiguration).toBeUndefined();
 });
 it('gives the API multipart upload/abort, read and delete access only to this bucket objects',()=>{
  const statements=resources.ApiStoragePolicy.Properties.PolicyDocument.Statement;
  expect(statements).toHaveLength(1);
  expect(statements[0].Effect).toBe('Allow');
  expect(statements[0].Action).toEqual(['s3:PutObject','s3:AbortMultipartUpload','s3:GetObject','s3:DeleteObject']);
  expect(statements[0].Resource).toEqual({'Fn::Sub':'${PrivateObjects.Arn}/*'});
 });
 it('restricts worker access to reads, cleanup and bucket-scoped orphan listing',()=>{
  expect(resources.WorkerStoragePolicy.Properties.PolicyDocument.Statement).toEqual([
   {Sid:'ReadAndCleanPrivateObjects',Effect:'Allow',Action:['s3:GetObject','s3:DeleteObject'],Resource:{'Fn::Sub':'${PrivateObjects.Arn}/*'}},
   {Sid:'ListForBoundedOrphanSweep',Effect:'Allow',Action:['s3:ListBucket'],Resource:{'Fn::GetAtt':['PrivateObjects','Arn']}},
  ]);
  expect(template.Outputs.PrivateBucketName.Value).toEqual({Ref:'PrivateObjects'});
  expect(template.Outputs.ApiStoragePolicyArn.Value).toEqual({Ref:'ApiStoragePolicy'});
  expect(template.Outputs.WorkerStoragePolicyArn.Value).toEqual({Ref:'WorkerStoragePolicy'});
 });
});
