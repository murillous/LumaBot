output "instance_id" {
  description = "ID da EC2"
  value       = aws_instance.luma_bot.id
}

output "public_ip" {
  description = "IP público da EC2"
  value       = aws_instance.luma_bot.public_ip
}

output "vpc_id" {
  description = "ID da VPC"
  value       = aws_vpc.luma_bot.id
}

output "security_group_id" {
  description = "ID do security group"
  value       = aws_security_group.luma_bot.id
}

output "ec2_role_arn" {
  description = "ARN da IAM role da EC2"
  value       = aws_iam_role.luma_bot_ec2.arn
}
