import {BadRequestException,Body,Controller,Injectable,Post} from '@nestjs/common';
import {IsEmail,IsIn,IsOptional,IsString,MaxLength,MinLength} from 'class-validator';
import {ApiTags} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {prisma,withPublicAbuseReport} from '@repus/database';

class CreateAbuseReportDto{
 @IsEmail() @MaxLength(320) senderEmail!:string;
 @IsOptional() @IsString() @MaxLength(160) campaignReference?:string;
 @IsOptional() @IsString() @MaxLength(320) messageId?:string;
 @IsOptional() @IsEmail() @MaxLength(320) contactEmail?:string;
 @IsIn(['unsolicited','misleading','phishing','other']) category!:string;
 @IsString() @MinLength(20) @MaxLength(3000) details!:string;
}
@Injectable()
export class AbuseReportsService{
 async submit(dto:CreateAbuseReportDto){
  const details=dto.details.trim();if(details.length<20)throw new BadRequestException('Please add at least 20 characters describing the message.');
  await withPublicAbuseReport(()=>prisma.abuseReport.createMany({data:[{senderAddress:dto.senderEmail.trim().toLowerCase(),campaignReference:dto.campaignReference?.trim()||undefined,messageId:dto.messageId?.trim()||undefined,reporterEmail:dto.contactEmail?.trim().toLowerCase()||undefined,category:dto.category,details}]}),{maxWait:5000,timeout:8000});
  return {received:true};
 }
}

@ApiTags('abuse reporting')
@Controller('abuse-reports')
export class AbuseReportsController{
 constructor(private service:AbuseReportsService){}
 @Post() @Throttle({default:{limit:5,ttl:60*60*1000}}) submit(@Body()dto:CreateAbuseReportDto){return this.service.submit(dto).then(data=>({data}));}
}
