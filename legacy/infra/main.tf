terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── VPC ──────────────────────────────────────────────────────────────────────

resource "aws_vpc" "luma_bot" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "luma-bot-${var.environment}"
  }
}

# ─── Subnet Pública ───────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.luma_bot.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"

  tags = {
    Name = "luma-bot-public-${var.environment}"
  }
}

# ─── Internet Gateway ─────────────────────────────────────────────────────────

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.luma_bot.id

  tags = {
    Name = "luma-bot-igw-${var.environment}"
  }
}

# ─── Route Table ──────────────────────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.luma_bot.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "luma-bot-public-rt-${var.environment}"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ─── Security Group ───────────────────────────────────────────────────────────

resource "aws_security_group" "luma_bot" {
  name        = "luma-bot-${var.environment}"
  description = "Security group for LumaBot EC2"
  vpc_id      = aws_vpc.luma_bot.id

  tags = {
    Name = "luma-bot-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.luma_bot.id
  cidr_ipv4         = var.allowed_ssh_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  description       = "SSH"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.luma_bot.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  description       = "HTTP"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.luma_bot.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS"
}

resource "aws_vpc_security_group_ingress_rule" "dashboard" {
  security_group_id = aws_security_group.luma_bot.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 3000
  to_port           = 3000
  ip_protocol       = "tcp"
  description       = "Dashboard"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.luma_bot.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "All outbound"
}

# ─── EC2 Instance ─────────────────────────────────────────────────────────────

resource "aws_instance" "luma_bot" {
  ami                    = var.instance_ami
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.luma_bot.id]
  key_name               = var.ssh_key_name
  iam_instance_profile   = aws_iam_instance_profile.luma_bot_ec2.name

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
    tags = {
      Name = "luma-bot-root-${var.environment}"
    }
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    domain_name          = var.domain_name
    environment          = var.environment
    ai_provider          = var.ai_provider
    gemini_api_key       = var.gemini_api_key
    openai_api_key       = var.openai_api_key
    deepseek_api_key     = var.deepseek_api_key
    tavily_api_key       = var.tavily_api_key
    owner_number         = var.owner_number
    log_level            = var.log_level
    dashboard_password   = var.dashboard_password
    cloudflare_api_token = var.cloudflare_api_token
    cloudflare_zone_id   = var.cloudflare_zone_id
    github_repo          = var.github_repo
  })

  tags = {
    Name        = "luma-bot-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
