data "aws_caller_identity" "current" {}

# ─── IAM Role para EC2 (SSM, CloudWatch) ─────────────────────────────────────
# Nota: A role OIDC do GitHub Actions (LumaBotGHActionsRole) é criada
# manualmente fora do Terraform (dependência circular). Veja docs/07-Producao.md.

resource "aws_iam_role" "luma_bot_ec2" {
  name = "LumaBotEC2Role"
  path = "/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ]
}

resource "aws_iam_instance_profile" "luma_bot_ec2" {
  name = "LumaBotEC2InstanceProfile"
  role = aws_iam_role.luma_bot_ec2.name
}
